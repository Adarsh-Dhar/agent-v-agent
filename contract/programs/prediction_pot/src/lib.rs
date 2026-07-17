use anchor_lang::prelude::*;
use anchor_lang::system_program;

// This is overwritten by `anchor keys sync` — see step 3 in the README.
declare_id!("DfYv5cMAvhLzLvUy6kYYQgyXewtjCyySZ1LBK8JQ9gwH");

#[program]
pub mod prediction_pot {
    use super::*;

    /// Creates a market for a match. `match_id_hash` is a 32-byte SHA256 hash
    /// of the match_id string to ensure fixed-length PDA seeds.
    /// The market account itself acts as the vault -- it holds every
    /// trader's escrowed stake, plus whatever extra house capital you seed
    /// it with (see README: seeding is just a plain SOL transfer to the
    /// market PDA's address, no instruction needed for that part).
    pub fn initialize_market(ctx: Context<InitializeMarket>, match_id_hash: [u8; 32]) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.match_id_hash = match_id_hash;
        market.status = MarketStatus::Open;
        market.bump = ctx.bumps.market;

        msg!("market opened for hash {:?}", market.match_id_hash);
        Ok(())
    }

    /// Opens a new position: escrows `stake` lamports from the trader into
    /// the market vault at the given entry price, recorded as basis points
    /// (odds * 10_000, e.g. 2.774 -> 27740) to keep everything integer math
    /// on-chain. `side` is 0 = buy, 1 = sell -- this mirrors the
    /// buy/sell semantics in the off-chain strategy engine directly, not
    /// the old home/away pari-mutuel side.
    ///
    /// `trade_id` must be a value this trader hasn't used before in this
    /// market. The client (the agent backend) owns incrementing it --
    /// Anchor's `init` constraint rejects a reused id outright since the
    /// PDA would already exist, so a collision fails safely rather than
    /// silently overwriting a prior trade.
    pub fn open_position(
        ctx: Context<OpenPosition>,
        trade_id: u64,
        side: u8,
        stake: u64,
        entry_odds_bps: u32,
    ) -> Result<()> {
        require!(side == 0 || side == 1, PotError::InvalidSide);
        require!(stake > 0, PotError::ZeroAmount);
        require!(entry_odds_bps > 0, PotError::InvalidOdds);
        require!(ctx.accounts.market.status == MarketStatus::Open, PotError::MarketNotOpen);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.trader.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            stake,
        )?;

        let position = &mut ctx.accounts.position;
        position.market = ctx.accounts.market.key();
        position.trader = ctx.accounts.trader.key();
        position.trade_id = trade_id;
        position.side = side;
        position.stake = stake;
        position.entry_odds_bps = entry_odds_bps;
        position.status = PositionStatus::Open;
        position.bump = ctx.bumps.position;

        msg!(
            "open trade_id={} side={} stake={} entry_odds_bps={}",
            trade_id, side, stake, entry_odds_bps
        );
        Ok(())
    }

    /// Settles a position's PnL immediately against the odds at close time
    /// -- no waiting for match resolution. Must be signed by the market
    /// authority, which in a solo-dev devnet setup is the same backend
    /// process that reads TxLINE's live odds. That's a real trust
    /// assumption (there's no independent on-chain price oracle here yet)
    /// -- document it as a known limitation rather than something this
    /// instruction tries to solve.
    ///
    /// PnL uses the identical formula as markToMarket() in the JS engine:
    ///   buy:  stake * (entry - exit) / entry
    ///   sell: stake * (exit - entry) / entry
    /// One difference from the off-chain simulator: losses are clamped to
    /// the escrowed stake. The JS sim can show losses past -100% (a
    /// stop-loss checked once a synthetic minute can't clip a 5x odds jump
    /// mid-tick), but on-chain there is no uncollateralized margin to draw
    /// on, so a trader can never lose more than what they escrowed here.
    pub fn close_position(ctx: Context<ClosePosition>, _trade_id: u64, exit_odds_bps: u32) -> Result<()> {
        require!(exit_odds_bps > 0, PotError::InvalidOdds);

        let position = &mut ctx.accounts.position;
        require!(position.status == PositionStatus::Open, PotError::PositionNotOpen);

        let stake = position.stake as i128;
        let entry = position.entry_odds_bps as i128;
        let exit = exit_odds_bps as i128;

        let raw_pnl: i128 = if position.side == 0 {
            // buy: profits when odds fall
            stake
                .checked_mul(entry - exit).ok_or(PotError::MathOverflow)?
                .checked_div(entry).ok_or(PotError::MathOverflow)?
        } else {
            // sell: profits when odds rise
            stake
                .checked_mul(exit - entry).ok_or(PotError::MathOverflow)?
                .checked_div(entry).ok_or(PotError::MathOverflow)?
        };

        let clamped_pnl = raw_pnl.max(-stake); // never lose more than the stake
        let payout = (stake + clamped_pnl) as u64; // always >= 0 by the clamp above

        position.status = PositionStatus::Closed;

        // The stake is already sitting in the market/vault account from
        // open_position. Pay `payout` from the vault to the trader -- a
        // loss just stays in the vault; a win beyond the original stake
        // draws on the vault's house-seeded capital.
        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.trader.to_account_info().try_borrow_mut_lamports()? += payout;

        msg!(
            "close trade_id={} exit_odds_bps={} pnl={} payout={}",
            position.trade_id, exit_odds_bps, clamped_pnl, payout
        );
        Ok(())
    }

    /// Stops the market from accepting new opens (e.g. once the match
    /// reaches fulltime). Existing open positions can still be closed --
    /// this only gates open_position, not close_position.
    pub fn close_market(ctx: Context<AuthorityOnly>) -> Result<()> {
        ctx.accounts.market.status = MarketStatus::Closed;
        Ok(())
    }
}

#[account]
pub struct Market {
    pub authority: Pubkey,    // 32 - who can close the market / sign closes
    pub match_id_hash: [u8; 32], // 32
    pub status: MarketStatus, // 1
    pub bump: u8,             // 1
}
impl Market {
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 1 + 1;
}

#[account]
pub struct Position {
    pub market: Pubkey,           // 32
    pub trader: Pubkey,           // 32
    pub trade_id: u64,            // 8
    pub side: u8,                 // 1 - 0 = buy, 1 = sell
    pub stake: u64,               // 8 - lamports escrowed at open
    pub entry_odds_bps: u32,      // 4 - odds * 10_000 at open
    pub status: PositionStatus,   // 1
    pub bump: u8,                 // 1
}
impl Position {
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 8 + 1 + 8 + 4 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PositionStatus {
    Open,
    Closed,
}

#[derive(Accounts)]
#[instruction(match_id_hash: [u8; 32])]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Market::MAX_SIZE,
        seeds = [b"market", &match_id_hash[..8]],
        bump
    )]
    pub market: Account<'info, Market>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64, side: u8, stake: u64, entry_odds_bps: u32)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(mut, seeds = [b"market", &market.match_id_hash[..8]], bump = market.bump)]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = trader,
        space = Position::MAX_SIZE,
        seeds = [b"position", market.key().as_ref(), trader.key().as_ref(), &trade_id.to_le_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(trade_id: u64, exit_odds_bps: u32)]
pub struct ClosePosition<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", &market.match_id_hash[..8]],
        bump = market.bump,
        has_one = authority
    )]
    pub market: Account<'info, Market>,

    /// CHECK: lamport-credit destination only. Its correctness is enforced
    /// by `has_one = trader` on `position` below -- if this account's key
    /// didn't match position.trader, that constraint fails the instruction.
    #[account(mut)]
    pub trader: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), trader.key().as_ref(), &trade_id.to_le_bytes()],
        bump = position.bump,
        has_one = trader,
        has_one = market,
    )]
    pub position: Account<'info, Position>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", &market.match_id_hash[..8]],
        bump = market.bump,
        has_one = authority
    )]
    pub market: Account<'info, Market>,
}

#[error_code]
pub enum PotError {
    #[msg("match_id is too long (max 32 bytes)")]
    MatchIdTooLong,
    #[msg("side must be 0 (buy) or 1 (sell)")]
    InvalidSide,
    #[msg("stake must be > 0")]
    ZeroAmount,
    #[msg("odds must be > 0")]
    InvalidOdds,
    #[msg("market is not open for new positions")]
    MarketNotOpen,
    #[msg("position is not open")]
    PositionNotOpen,
    #[msg("math overflow")]
    MathOverflow,
}
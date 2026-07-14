use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

// This is overwritten by `anchor keys sync` — see step 3 in the README.
declare_id!("7qQaQpaS5oiSYSgq9o5LzJ1EPBMLdbGzrhBMertmpDeU");

#[program]
pub mod prediction_pot {
    use super::*;

    /// Creates a new market for a match. `match_id` should match the TxLINE
    /// match/fixture id string so you can correlate a pot with real data.
    pub fn initialize_market(ctx: Context<InitializeMarket>, match_id: String) -> Result<()> {
        require!(match_id.len() <= MAX_MATCH_ID_LEN, PotError::MatchIdTooLong);

        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.match_id = match_id;
        market.pool_a = 0;
        market.pool_b = 0;
        market.status = MarketStatus::Open;
        market.winning_side = None;
        market.bump = ctx.bumps.market;

        msg!("market opened for {}", market.match_id);
        Ok(())
    }

    /// Stakes `amount` lamports on `side` (0 = side A / home, 1 = side B / away).
    /// One bet per (market, better) — this keeps the account model and the
    /// payout math simple. Funds move straight into the market PDA itself,
    /// which acts as the vault since it's owned by this program.
    pub fn place_bet(ctx: Context<PlaceBet>, side: u8, amount: u64) -> Result<()> {
        require!(side == 0 || side == 1, PotError::InvalidSide);
        require!(amount > 0, PotError::ZeroAmount);

        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, PotError::MarketNotOpen);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.better.to_account_info(),
                    to: market.to_account_info(),
                },
            ),
            amount,
        )?;

        if side == 0 {
            market.pool_a = market.pool_a.checked_add(amount).ok_or(PotError::MathOverflow)?;
        } else {
            market.pool_b = market.pool_b.checked_add(amount).ok_or(PotError::MathOverflow)?;
        }

        let position = &mut ctx.accounts.position;
        position.market = market.key();
        position.better = ctx.accounts.better.key();
        position.side = side;
        position.amount = amount;
        position.claimed = false;
        position.bump = ctx.bumps.position;

        msg!("bet placed: side={} amount={}", side, amount);
        Ok(())
    }

    /// Locks the market so no further bets can be placed. Optional step —
    /// you can skip straight to resolve_market if you'd rather stake stay
    /// open until fulltime.
    pub fn lock_market(ctx: Context<AuthorityOnly>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, PotError::MarketNotOpen);
        market.status = MarketStatus::Locked;
        Ok(())
    }

    /// Settles the match outcome. For a hackathon MVP this is called by the
    /// market authority (your backend, after reading TxLINE's final score).
    /// A more trustless version would instead read TxLINE's on-chain score
    /// proof PDA directly inside this instruction.
    pub fn resolve_market(ctx: Context<AuthorityOnly>, winning_side: u8) -> Result<()> {
        require!(winning_side == 0 || winning_side == 1, PotError::InvalidSide);
        let market = &mut ctx.accounts.market;
        require!(market.status != MarketStatus::Resolved, PotError::AlreadyResolved);
        market.status = MarketStatus::Resolved;
        market.winning_side = Some(winning_side);
        msg!("market resolved: winning_side={}", winning_side);
        Ok(())
    }

    /// Pays out a winning position: original stake + a proportional share of
    /// the losing pool. Losers simply never call this — their stake stays in
    /// the market account and is distributed to winners.
    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.status == MarketStatus::Resolved, PotError::MarketNotResolved);

        let position = &mut ctx.accounts.position;
        require!(!position.claimed, PotError::AlreadyClaimed);

        let winning_side = market.winning_side.ok_or(PotError::MarketNotResolved)?;
        require!(position.side == winning_side, PotError::NotAWinner);

        let (winning_pool, losing_pool) = if winning_side == 0 {
            (market.pool_a, market.pool_b)
        } else {
            (market.pool_b, market.pool_a)
        };
        require!(winning_pool > 0, PotError::MathOverflow);

        // payout = stake + stake * losing_pool / winning_pool, done in u128
        // to avoid overflow before the division.
        let stake = position.amount as u128;
        let bonus = stake
            .checked_mul(losing_pool as u128)
            .ok_or(PotError::MathOverflow)?
            .checked_div(winning_pool as u128)
            .ok_or(PotError::MathOverflow)?;
        let payout = stake.checked_add(bonus).ok_or(PotError::MathOverflow)? as u64;

        position.claimed = true;

        // Direct lamport transfer: legal here because the market PDA is
        // owned by this program, so this program is allowed to debit it.
        // Crediting the better's wallet is unrestricted.
        **market.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.better.to_account_info().try_borrow_mut_lamports()? += payout;

        msg!("paid out {} lamports to {}", payout, ctx.accounts.better.key());
        Ok(())
    }
}

const MAX_MATCH_ID_LEN: usize = 32;

#[account]
pub struct Market {
    pub authority: Pubkey,       // 32 - who can lock/resolve
    pub match_id: String,        // 4 + 32
    pub pool_a: u64,             // 8
    pub pool_b: u64,             // 8
    pub status: MarketStatus,    // 1
    pub winning_side: Option<u8>,// 2
    pub bump: u8,                // 1
}
impl Market {
    pub const MAX_SIZE: usize = 8 + 32 + (4 + MAX_MATCH_ID_LEN) + 8 + 8 + 1 + 2 + 1;
}

#[account]
pub struct Position {
    pub market: Pubkey, // 32
    pub better: Pubkey, // 32
    pub side: u8,        // 1
    pub amount: u64,     // 8
    pub claimed: bool,   // 1
    pub bump: u8,         // 1
}
impl Position {
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Locked,
    Resolved,
}

#[derive(Accounts)]
#[instruction(match_id: String)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Market::MAX_SIZE,
        seeds = [b"market", match_id.as_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(side: u8, amount: u64)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub better: Signer<'info>,

    #[account(mut, seeds = [b"market", market.match_id.as_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = better,
        space = Position::MAX_SIZE,
        seeds = [b"position", market.key().as_ref(), better.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.match_id.as_bytes()],
        bump = market.bump,
        has_one = authority
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(mut)]
    pub better: Signer<'info>,

    #[account(mut, seeds = [b"market", market.match_id.as_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), better.key().as_ref()],
        bump = position.bump,
        has_one = better
    )]
    pub position: Account<'info, Position>,
}

#[error_code]
pub enum PotError {
    #[msg("match_id is too long (max 32 bytes)")]
    MatchIdTooLong,
    #[msg("side must be 0 (A) or 1 (B)")]
    InvalidSide,
    #[msg("bet amount must be > 0")]
    ZeroAmount,
    #[msg("market is not open for betting")]
    MarketNotOpen,
    #[msg("market is not resolved yet")]
    MarketNotResolved,
    #[msg("market has already been resolved")]
    AlreadyResolved,
    #[msg("this position already claimed its payout")]
    AlreadyClaimed,
    #[msg("this position did not back the winning side")]
    NotAWinner,
    #[msg("math overflow")]
    MathOverflow,
}

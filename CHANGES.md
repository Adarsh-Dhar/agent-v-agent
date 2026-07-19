# Match Purse and Status Guard Fixes

## Problem

The original implementation had two critical issues:

1. **Missing `initial_purse` on matches row**: The `initial_purse` was only stored on the first player's row in `match_players`, making it fragile and requiring workarounds to read it back.

2. **No status guards**: Players could join matches and swap agents even after the match started (status != 'pending'), which could cause race conditions and inconsistent state.

## Solution

### 1. Database Migration
**File**: `sql-files/010_add_initial_purse_to_matches.sql`

- Added `initial_purse` column to `matches` table with default value of 1.0
- Added index on `initial_purse` for performance
- Backfilled existing matches by copying from the first player's `initial_purse`

### 2. API Changes

#### POST /api/matches/join
**File**: `frontend/app/api/matches/join/route.ts`

- **Fixed purse bug**: Now reads `initial_purse` directly from `matches.initial_purse` instead of relying on the match row having the value
- **Added `initial_purse` and `pnl` fields**: When inserting a new player, now properly sets both `purse` and `initial_purse` to the match's initial purse, and initializes `pnl` to 0
- **Status guard already present**: The endpoint already had a status guard preventing joins to non-pending matches

#### POST /api/matches/[code]
**File**: `frontend/app/api/matches/[code]/route.ts`

- **Removed workaround**: Eliminated the fragile logic that read `initial_purse` from the first player's row
- **Direct read**: Now reads `initial_purse` directly from `match.initial_purse`
- **Added status guard**: Now blocks agent joins when match status is not 'pending'

#### PUT /api/match-players/[id]
**File**: `frontend/app/api/match-players/[id]/route.ts`

- **Added status guard**: Now blocks agent swaps when the match status is not 'pending'
- **Fetches match status**: Queries the match table to check status before allowing agent changes

#### POST /api/matches
**File**: `frontend/app/api/matches/route.ts`

- **Already correct**: This endpoint was already persisting `initial_purse` on the matches row (line 199)

## Files Changed

1. `sql-files/010_add_initial_purse_to_matches.sql` - New migration file
2. `frontend/app/api/matches/join/route.ts` - Fixed purse bug, added proper field initialization
3. `frontend/app/api/matches/[code]/route.ts` - Removed workaround, added status guard
4. `frontend/app/api/match-players/[id]/route.ts` - Added status guard for agent swaps

## Order of Operations

1. Run the SQL migration in Supabase:
   ```sql
   -- Execute sql-files/010_add_initial_purse_to_matches.sql
   ```

2. Apply the TypeScript changes (either via patches or by copying updated files):
   - Option A: Apply patches using `git apply patches/*.patch`
   - Option B: Copy the updated files directly from `updated-files/` directory

## Verification

After applying these changes:
- New matches will have `initial_purse` stored on the matches row
- Existing matches will be backfilled with their correct `initial_purse` from the first player
- Players can only join matches when status is 'pending'
- Agents can only be swapped when match status is 'pending'
- No more fragile workarounds reading from player rows to get match configuration

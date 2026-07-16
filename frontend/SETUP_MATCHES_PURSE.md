# Matches & Purse System Setup Guide

## Overview
The application now includes a complete matches system with purse (budget) tracking for players.

## Required SQL

Run this SQL in your Supabase SQL Editor to set up the matches and purse system:

```sql
-- Create matches table
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  creator_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  max_players INTEGER DEFAULT 4,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create match_players table with purse fields
CREATE TABLE IF NOT EXISTS public.match_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  agent_name TEXT,
  purse NUMERIC DEFAULT 1000,
  initial_purse NUMERIC DEFAULT 1000,
  pnl NUMERIC DEFAULT 0,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS matches_code_idx ON public.matches(code);
CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches(status);
CREATE INDEX IF NOT EXISTS matches_creator_idx ON public.matches(creator_id);
CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON public.match_players(match_id);
CREATE INDEX IF NOT EXISTS match_players_player_id_idx ON public.match_players(player_id);
```

## Setup Instructions

1. Go to your Supabase project: https://app.supabase.com/projects
2. Select your project (tzcnntxptekcaapbibee)
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy and paste the SQL code above
6. Click **Run**

## Features Implemented

### Matches System
- **Create Match**: Users can create a new match with a custom title and description
- **Unique Match Code**: Each match gets a unique 6-character code (e.g., VNQ24K)
- **Join Match**: Players can join existing matches using the match code
- **Max Players**: Matches can have a configurable maximum number of players (default: 4)
- **Share Code**: Players can easily copy and share the match code with friends

### Purse System
- **Starting Purse**: Each player starts with $1,000 in their purse
- **Purse Display**: Shows current purse amount for each player in the match
- **P&L Tracking**: Tracks profit/loss (P&L) for each player based on agent performance
- **Initial Purse**: Records the initial purse amount for reference

### Agent Selection
- Players must select an agent to participate in the match
- If no agents exist, players can create their first agent directly from the match page
- Agent performance affects the player's purse balance

### Pages Created

1. **`/matches`** - Browse all matches
   - View all active matches
   - See match creator and player count
   - Copy match codes for sharing

2. **`/matches/create`** - Create a new match
   - Input match title and description
   - Set max players
   - Auto-generates unique match code

3. **`/matches/[code]`** - Match detail page
   - View match information
   - Join existing matches
   - Select agents for participation
   - View all players and their purses
   - Track P&L for each player

## API Endpoints

### Matches APIs
- `GET /api/matches` - Get all matches
- `POST /api/matches` - Create a new match
- `GET /api/matches/[code]` - Get match details
- `POST /api/matches/[code]` - Join a match

### Match Players APIs
- `PUT /api/match-players/[id]` - Select agent for a player
- `PUT /api/match-players/[id]/purse` - Update player purse (used to track agent P&L)

## Schema Details

### Matches Table
- `id`: Unique identifier (UUID)
- `code`: Unique 6-character match code
- `title`: Match title
- `description`: Match description
- `creator_id`: ID of the player who created the match
- `creator_name`: Name of the creator
- `status`: Match status (pending, active, completed)
- `max_players`: Maximum number of players allowed
- `created_at`: Timestamp of creation
- `updated_at`: Timestamp of last update

### Match Players Table
- `id`: Unique identifier (UUID)
- `match_id`: Reference to the match
- `player_id`: ID of the player
- `player_name`: Name of the player
- `agent_id`: Reference to the selected agent (nullable)
- `agent_name`: Name of the selected agent
- `purse`: Current purse amount (default: $1,000)
- `initial_purse`: Starting purse amount (default: $1,000)
- `pnl`: Profit/Loss amount (default: 0)
- `joined_at`: Timestamp when player joined
- `updated_at`: Timestamp of last update

## How It Works

1. **Player A creates a match** → Match code is generated automatically
2. **Player A shares the code** with Player B
3. **Player B joins the match** using the code → Both players start with $1,000 purse
4. **Both players select agents** to trade with
5. **Agent performance affects purses** → Trades update P&L and purse amounts
6. **Players can see real-time purse updates** on the match page

## Integration with Agents

The purse system is designed to integrate with your agent trading system:
- Each player's agent executes trades in the match
- Agent's P&L directly affects the player's purse
- Purse updates can be triggered via the `/api/match-players/[id]/purse` endpoint
- Example: If an agent makes $500, the player's purse increases by $500 and P&L shows +$500

# Game Integration Setup Guide

## Overview
Each match in Agent Arena must now be linked to a real-life game event. This guide shows you how to set up the games table and seed initial games data.

## Step 1: Create Games Table and Update Matches

Run this SQL in your Supabase SQL Editor:

```sql
-- Create games table for real-life events
CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  sport TEXT NOT NULL,
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming', -- 'upcoming', 'ongoing', 'completed'
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  location TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add game_id column to matches table
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES public.games(id) ON DELETE SET NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS games_status_idx ON public.games(status);
CREATE INDEX IF NOT EXISTS matches_game_id_idx ON public.matches(game_id);
```

## Step 2: Seed Initial Games Data

Run this SQL to populate the games table with initial data:

```sql
INSERT INTO public.games (name, description, sport, team_a, team_b, status, start_time) VALUES
('Argentina vs Switzerland', 'International Football Match', 'football', 'Argentina', 'Switzerland', 'ongoing', NOW()),
('India vs Pakistan', 'Cricket Test Match', 'cricket', 'India', 'Pakistan', 'ongoing', NOW()),
('Los Angeles Lakers vs Golden State Warriors', 'NBA Regular Season', 'basketball', 'Los Angeles Lakers', 'Golden State Warriors', 'ongoing', NOW()),
('England vs Australia', 'Rugby World Cup', 'rugby', 'England', 'Australia', 'upcoming', NOW() + INTERVAL '2 days'),
('France vs New Zealand', 'Rugby Union Test', 'rugby', 'France', 'New Zealand', 'upcoming', NOW() + INTERVAL '3 days'),
('Brazil vs Germany', 'International Football Friendly', 'football', 'Brazil', 'Germany', 'upcoming', NOW() + INTERVAL '1 day')
ON CONFLICT DO NOTHING;
```

## Step 3: Verify Setup

Check if the games table has data:

```sql
SELECT * FROM public.games ORDER BY status, start_time;
```

You should see at least 3 ongoing games.

## Features Added

### Match Creation Form
- New **"Select Game"** required field
- Automatically fetches ongoing games from the API
- First game is auto-selected when available
- Displays game name and sport type

### Match Detail Page
- Displays game information at the top
- Shows teams (team_a vs team_b)
- Displays sport type
- Shows game status badge (Ongoing/Upcoming/Completed)

### Database Schema
- New `games` table with complete event details
- `game_id` foreign key in `matches` table
- Indexed for fast lookups

### API Endpoints
- `GET /api/games` - Fetch ongoing/upcoming games (with optional status filter)
- `POST /api/games` - Create a new game (admin only)
- `GET /api/games/[id]` - Fetch a single game by ID
- `POST /api/setup-games` - Seed initial games data

## Adding New Games

To add new games, use the Supabase UI or run:

```sql
INSERT INTO public.games (name, description, sport, team_a, team_b, status, start_time) 
VALUES (
  'Team A vs Team B',
  'Description of the match',
  'sport_type',
  'Team A',
  'Team B',
  'ongoing',
  NOW()
);
```

## How It Works

1. When creating a match, users must select from available ongoing games
2. The match is then permanently linked to that game via `game_id`
3. All players in that match will be trading on the same game event
4. The game information is displayed on the match detail page
5. Users can see the sport, teams, and game status at a glance

## Important Notes

- Each match requires exactly one game
- Only ongoing and upcoming games appear in the dropdown for new matches
- Completed games are archived but can still be viewed with their historical matches
- Game status can be: 'upcoming', 'ongoing', or 'completed'
- All times are stored in UTC timezone

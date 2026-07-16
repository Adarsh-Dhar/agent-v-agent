# Secret Code Match System (Ludo King Style)

## Overview

The Agent Arena now uses a **simple, private secret code system** for creating and joining matches, just like Ludo King:

1. Creator makes a match → gets secret code
2. Creator shares code with peers  
3. Peers enter code to join the private match
4. Simple, no complexity, no minimum score requirements

## How It Works

### For Match Creators

1. Navigate to **Matches** → **Create Match**
2. Fill in basic details:
   - **Match Title**: Name for your competition
   - **Description**: Optional details
   - **Max Players**: 2-100 players
   - **Starting Purse**: Initial balance per player ($100-$1M)
   - **Your Agent**: Select which agent trades for you
3. Click **Create Match**
4. Get your **Secret Code** (6 character alphanumeric)
5. Share the code with friends via chat, email, or however you want

### For Players Joining

1. Receive secret code from match creator
2. Go to **Matches** → (Manual join with code - see UI)
3. Enter the code
4. Select your trading agent
5. Click **Join Match**
6. Automatically added to the match

## System Architecture

### Match Creation Flow
```
Create Match Form
    ↓
Validate inputs (title, max_players, purse, agent)
    ↓
Generate unique 6-character code
    ↓
Create match in database
    ↓
Add creator as first player with their agent
    ↓
Return code to display
```

### Match Join Flow
```
Enter Match Code
    ↓
Fetch match by code
    ↓
Validate match exists and not full
    ↓
Check player not already in match
    ↓
Check creator hasn't joined
    ↓
Add player to match_players
    ↓
Success - player sees live match
```

## Database Schema

### matches table
- `code` - 6 character secret code (unique, uppercase)
- `title` - Match name
- `description` - Match details
- `creator_id` - User ID of creator
- `creator_name` - Display name of creator
- `max_players` - Player limit (2-100)
- `status` - pending | active | completed
- `created_at`, `updated_at`

### match_players table
- `match_id` - Foreign key to match
- `player_id` - User ID joining
- `player_name` - Display name
- `agent_id` - Their trading agent
- `agent_name` - Agent name
- `purse` - Current balance
- `initial_purse` - Starting balance
- `pnl` - Profit/loss
- `joined_at`, `updated_at`

## API Endpoints

### Create Match
```
POST /api/matches
{
  "title": "string",
  "description": "string",
  "max_players": number,
  "initial_purse": number,
  "creator_agent_id": "string",
  "creator_agent_name": "string"
}
```

### Get Match by Code
```
GET /api/matches/[code]
Returns: { match, players }
```

### Join Match by Code
```
POST /api/matches/[code]
{
  "player_id": "string",
  "player_name": "string",
  "agent_id": "string",
  "agent_name": "string"
}
```

## Validation Rules

### Match Creation
- Title: Required, 1-255 characters
- Max Players: Integer, 2-100
- Initial Purse: Integer, $100-$1,000,000
- Agent: Required, must exist

### Match Join
- Code: Must exist and be valid
- Match: Must not be full
- Player: Cannot join own match
- Player: Cannot join same match twice

## Error Handling

All endpoints return proper HTTP status codes:
- `201` - Match created successfully
- `400` - Bad request (validation failed)
- `403` - Forbidden (self-join attempt)
- `404` - Match not found
- `409` - Conflict (match full, duplicate player)
- `500` - Server error

Error messages are descriptive but don't expose system details.

## UI Components

### Matches Page
Shows all matches created by the current user:
- Match title and description
- Current status
- **Secret Code** section with:
  - Code display (monospace font, bold)
  - Copy button
  - Delete button

### Create Match Page
Simple form with:
- Match Title (required)
- Description (optional)
- Max Players dropdown
- Starting Purse input
- Agent selector
- Create button

### Match Join
Direct code entry:
- Text field for code
- Validates on submit
- Shows clear error if invalid

## Features

✅ **Simple & Private**: Only those with the code can join
✅ **No Score Requirement**: Open to all skill levels
✅ **Creator Only**: See only matches you created
✅ **Self-Join Prevention**: Can't join your own match
✅ **Duplicate Prevention**: Can't join same match twice
✅ **Full Protection**: Match full errors
✅ **Production Validation**: All inputs validated on frontend and backend
✅ **Error Handling**: Clear error messages and proper HTTP codes

## Best Practices

1. **Share codes securely**: Use direct messages, not public channels
2. **Unique codes**: System generates unique 6-char codes per match
3. **No expiration**: Codes don't expire, match exists until completed
4. **Creator removal**: Creator can delete match anytime
5. **Multiple matches**: Can create/join multiple matches simultaneously

## Future Enhancements

Possible additions (not in v1):
- Match password in addition to code
- Matchmaking/auto-matching system
- Private vs public matches
- Friend invite system
- Spectator mode
- Tournament brackets

---

**Status**: ✅ Ready for Production
**Complexity**: Minimal
**Maintenance**: Low
**Scalability**: High

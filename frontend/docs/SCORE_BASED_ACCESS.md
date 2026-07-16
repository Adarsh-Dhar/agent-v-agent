# Score-Based Match Access Control System

## Overview

The Agent Arena now implements a **two-factor access control system** for matches using:
1. **Secret Match Code** - Private access token
2. **Minimum Score Requirement** - Skill-based gating

This ensures matches are truly private and only accessible to qualified players.

## Features

### 1. Minimum Score Setting
When creating a match, creators can set a minimum score requirement:
- **Range**: 0 to 1,000,000
- **Default**: 0 (open to all players)
- **Format**: Integer
- **UI**: "Minimum Score Required to Join" field in match creation form

### 2. Score Validation on Join
When a player attempts to join a match:
- Player's `score` field is fetched (fallback to `total_pnl`)
- Score is compared against match's `min_score`
- If score is insufficient:
  - HTTP 403 Forbidden response
  - Message: "Your score (X) does not meet the minimum requirement (Y)"
  - Player cannot join

### 3. Visual Indication
Match cards display the minimum score requirement:
- Badge shows: "Min Score: 500"
- Only visible if `min_score > 0`
- Indicates private/restricted access

## API Endpoints

### POST /api/matches (Create Match)

**Request Body:**
```json
{
  "title": "Competitive Trading Championship",
  "description": "For experienced traders only",
  "max_players": 4,
  "initial_purse": 5000,
  "min_score": 500,
  "creator_agent_id": "agent-uuid",
  "creator_agent_name": "Elite Agent"
}
```

**Validation:**
- `min_score`: Integer, 0-1,000,000
- Returns 400 if invalid
- Default: 0

### POST /api/matches/[code] (Join Match)

**Join Validation Flow:**
1. Match code validated
2. Player ID validated
3. Player data fetched (score field)
4. Score compared to match.min_score
5. If insufficient: Return 403 with error
6. If sufficient: Allow join

**Error Response (403):**
```json
{
  "error": "Forbidden: Your score (150) does not meet the minimum requirement (500)"
}
```

## Frontend Implementation

### Match Creation Form
```jsx
<input
  type="number"
  name="min_score"
  value={formData.min_score}
  min="0"
  step="10"
  placeholder="Minimum player score to join (0 = open to all)"
/>
```

**Validation Rules:**
- Integer between 0 and 1,000,000
- Error handling on submission
- User-friendly error messages

### Matches Display
```jsx
{match.min_score > 0 && (
  <div className="px-3 py-2 bg-muted/50 rounded text-xs">
    <span className="text-muted-foreground">Min Score: </span>
    <span className="font-semibold text-foreground">{match.min_score}</span>
  </div>
)}
```

## Database Schema

### Matches Table
```sql
CREATE TABLE matches (
  id UUID PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  creator_id UUID NOT NULL,
  creator_name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  max_players INTEGER DEFAULT 4,
  min_score INTEGER DEFAULT 0,
  initial_purse INTEGER DEFAULT 1000,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Players Table
```sql
ALTER TABLE players ADD COLUMN score INTEGER DEFAULT 0;
-- Or use existing total_pnl as fallback
```

## Use Cases

### 1. Open Match (min_score = 0)
- Available to all players with match code
- No skill barrier
- Example: Casual trading competition

### 2. Intermediate Match (min_score = 100)
- Only players with score ≥ 100 can join
- Code must still be shared
- Example: Intermediate trader competition

### 3. Expert-Only Match (min_score = 1000)
- Only elite players can join
- Highly exclusive
- Example: Professional trading championship

## Error Handling

### Common Errors

| Scenario | HTTP Code | Message |
|----------|-----------|---------|
| Match not found | 404 | Not Found: Match with this code does not exist |
| Player already in match | 400 | Bad Request: Player already in this match |
| Score insufficient | 403 | Forbidden: Your score (X) does not meet the minimum requirement (Y) |
| Match is full | 409 | Conflict: Match is full |
| Invalid min_score | 400 | Bad Request: Minimum score must be between 0 and 1,000,000 |

### Production Error Standards

All errors follow production standards:
- ✅ Proper HTTP status codes
- ✅ Clear error messages
- ✅ No sensitive data exposure
- ✅ No database schema leaks
- ✅ Validation on all inputs

## Security

### Two-Factor Access Control
1. **First Factor**: Secret match code (known only to creator)
2. **Second Factor**: Minimum score requirement

This prevents:
- Unauthorized random joins
- Low-skill players disrupting competitive matches
- Mass joining with multiple accounts

### Data Validation
- All inputs validated on frontend AND backend
- Score fetched at join time (real-time check)
- No client-side score manipulation

## Examples

### Creating a Competitive Match
```javascript
// POST /api/matches
{
  "title": "World Cup Final Trading",
  "description": "Competitive traders only",
  "max_players": 8,
  "initial_purse": 10000,
  "min_score": 1000,  // ← Only top traders
  "creator_agent_id": "agent-123",
  "creator_agent_name": "Pro Trader Agent"
}

// Response
{
  "match": {
    "id": "match-uuid",
    "code": "ABC123",
    "min_score": 1000,
    ...
  }
}
```

### Attempting to Join Without Required Score
```javascript
// POST /api/matches/ABC123
{
  "player_id": "player-456",
  "player_name": "Beginner Trader",
  "agent_id": "agent-456",
  "agent_name": "Learning Agent"
}

// Response (403)
{
  "error": "Forbidden: Your score (250) does not meet the minimum requirement (1000)"
}
```

### Joining with Sufficient Score
```javascript
// POST /api/matches/ABC123
{
  "player_id": "player-789",
  "player_name": "Expert Trader",
  "agent_id": "agent-789",
  "agent_name": "Expert Agent"
}

// Response (201)
{
  "player": {
    "id": "mp-uuid",
    "match_id": "match-uuid",
    "player_id": "player-789",
    ...
  }
}
```

## Best Practices

### For Match Creators
1. Set appropriate minimum score
2. Share match code only with intended players
3. Use clear titles to indicate difficulty level
4. Set reasonable purse for skill level

### For Players
1. Build your score in practice matches first
2. Join appropriate skill-level matches
3. Track your score improvement
4. Share codes only with trusted players

## Migration Guide

If adding this to existing database:

```sql
-- Add min_score column to matches table
ALTER TABLE matches ADD COLUMN min_score INTEGER DEFAULT 0;

-- Add score column to players table
ALTER TABLE players ADD COLUMN score INTEGER DEFAULT 0;

-- Update existing players score from total_pnl
UPDATE players SET score = total_pnl WHERE score = 0;
```

## Testing

### Test Case 1: Open Match
- Create match with min_score = 0
- Any player can join
- ✅ Pass

### Test Case 2: Restricted Match
- Create match with min_score = 500
- Player with score 250 tries to join
- Should get 403 error
- ✅ Pass

### Test Case 3: Valid Join
- Create match with min_score = 500
- Player with score 750 joins
- Should succeed
- ✅ Pass

### Test Case 4: Invalid Score Value
- Create match with min_score = 1000001
- Should get 400 validation error
- ✅ Pass

## Conclusion

The score-based access control system makes matches truly private and competitive. Combined with secret codes, it provides a complete access control solution that prevents unwanted joins while enabling easy sharing with intended players.

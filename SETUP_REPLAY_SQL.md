# Setup Replay Match - SQL Instructions

## Step 1: Add Replay Support Columns

Go to your Supabase dashboard → SQL Editor and run this SQL:

```sql
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS is_replay BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fixture_id TEXT,
ADD COLUMN IF NOT EXISTS agent_match_id TEXT;

CREATE INDEX IF NOT EXISTS matches_fixture_id_idx ON public.matches(fixture_id) WHERE is_replay = true;
```

## Step 2: Update Your Match to Replay Mode

After running the above SQL, run this to update your specific match:

```sql
UPDATE public.matches 
SET 
  is_replay = true,
  fixture_id = '18241006',
  agent_match_id = 'replay-18241006'
WHERE code = '7E5VJGNWB3P';
```

## Step 3: Verify the Update

Check that the match is updated:

```sql
SELECT code, is_replay, fixture_id, agent_match_id, status 
FROM public.matches 
WHERE code = '7E5VJGNWB3P';
```

## Step 4: Test

After running these SQL commands:
1. Refresh your match page in the browser
2. Start the match
3. The agent should now use `match_id: replay-18241006`
4. It will fetch data from the replay fixture at `/server/src/lib/replays/18241006.json`
5. You should see real-time trading activity in the charts

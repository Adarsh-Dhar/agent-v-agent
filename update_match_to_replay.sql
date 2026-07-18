-- Update existing match to be a replay match
-- Replace '7E5VJGNWB3P' with your actual match code if different
UPDATE public.matches 
SET 
  is_replay = true,
  fixture_id = '18222446',
  agent_match_id = 'replay-18222446'
WHERE code = '7E5VJGNWB3P';

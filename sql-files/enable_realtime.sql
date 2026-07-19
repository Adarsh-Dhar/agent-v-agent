-- Enable Realtime for matches table
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;

-- Enable Realtime for match_players table
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_players;

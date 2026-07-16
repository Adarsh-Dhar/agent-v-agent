// matchClock.js
//
// ============================================================================
// SHARED, RACE-SAFE MATCH EPOCH
// ============================================================================
// Problem this solves: every agent "run" for a match is spawned as its own
// OS process (see server.js). For replay/mock matches, the previous code let
// each process seed its own match-start time from `Date.now()` the first
// moment it happened to tick. Spawn latency, DB round trips, and normal
// event-loop jitter mean different agents' processes reach that first tick
// a few seconds apart -- so two agents nominally trading the *same* match_id
// end up permanently offset from each other for the whole match, and their
// graphs never line up.
//
// Fix: treat "when did this match start" as a fact that lives in Supabase
// (the shared source of truth already used for agents/agent_runs/trades),
// not as something any one worker process invents locally. Every process
// that touches a given match_id calls getMatchEpoch(matchId), which:
//   1. Tries to atomically INSERT the epoch row (upsert with
//      ignoreDuplicates), so the *first* process to ask wins the race and
//      everyone else's insert is a silent no-op.
//   2. Reads the row straight back, so every process -- regardless of
//      whether it created the row or arrived milliseconds/seconds later --
//      converges on the exact same epoch timestamp.
//
// Callers then compute their timeline position as elapsed = now - epoch and
// derive state as a pure function of `elapsed` (see txlineReplay.js /
// mockTxlineFeed.js), rather than incrementing a local counter per tick.
// That makes the whole thing self-correcting: a slow tick, a missed tick, or
// a process joining late doesn't cause drift, because nothing is ever
// accumulated locally -- every reader just re-derives the same answer from
// the same shared epoch.
// ============================================================================

import { supabase } from './supabaseClient.js';

// Small in-process cache so we don't round-trip to Supabase on every single
// tick (agentRunner.js polls frequently). The cached value is only ever the
// *epoch timestamp itself*, which never changes once set -- so caching it
// locally is safe and doesn't reintroduce the drift bug (unlike caching
// currentIndex, which is derived state).
const epochCache = new Map();

/**
 * Get (or race-safely create) the authoritative start epoch for a match, as
 * a Unix ms timestamp. Safe to call concurrently from many independently-
 * spawned processes for the same match_id -- exactly one INSERT wins, and
 * every caller reads back the same row.
 */
export async function getMatchEpoch(matchId) {
  if (epochCache.has(matchId)) {
    return epochCache.get(matchId);
  }

  const nowIso = new Date().toISOString();

  // First writer wins. `ignoreDuplicates: true` makes this a no-op (not an
  // error) for every process that loses the race on match_id's uniqueness
  // constraint -- see schema.sql (`match_clocks_match_id_key`).
  const { error: insertError } = await supabase
    .from('match_clocks')
    .upsert({ match_id: matchId, started_at: nowIso }, { onConflict: 'match_id', ignoreDuplicates: true });

  if (insertError) {
    throw new Error(`getMatchEpoch: failed to upsert epoch row for ${matchId}: ${insertError.message}`);
  }

  const { data, error: selectError } = await supabase
    .from('match_clocks')
    .select('started_at')
    .eq('match_id', matchId)
    .single();

  if (selectError || !data) {
    throw new Error(`getMatchEpoch: failed to read back epoch row for ${matchId}: ${selectError?.message ?? 'no row'}`);
  }

  const epochMs = new Date(data.started_at).getTime();
  epochCache.set(matchId, epochMs);
  return epochMs;
}

/**
 * Test/dev helper: clear the local cache (does NOT touch the DB row). Useful
 * if a test wants to force a re-fetch; does not reset the shared epoch --
 * use resetMatchEpoch() for that.
 */
export function clearEpochCache(matchId) {
  epochCache.delete(matchId);
}

/**
 * Explicitly clear the shared epoch for a match, so the *next* caller to ask
 * re-elects a fresh start time. Intended for deliberate match restarts only
 * -- normal reconnects/reruns should NOT call this, or you reintroduce the
 * exact drift this module exists to prevent.
 */
export async function resetMatchEpoch(matchId) {
  epochCache.delete(matchId);
  const { error } = await supabase.from('match_clocks').delete().eq('match_id', matchId);
  if (error) {
    throw new Error(`resetMatchEpoch: failed to delete epoch row for ${matchId}: ${error.message}`);
  }
}

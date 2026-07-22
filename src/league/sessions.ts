import type { Match, SessionId } from "../domain/index.js";

/**
 * Layer 3 — League Logic.
 *
 * Session-scoped slices of already-recorded facts. Sessions still bound two
 * things — **standings reset** each session, and scheduling is per-session — but
 * they no longer freeze ratings. Ball spots follow a per-player, every-20-games
 * policy that ignores session boundaries; see `spotRatingsFor` in
 * [spotRatings.ts]. Nothing here computes a rating.
 */

/** The matches played in one session, in their original order. */
export function matchesInSession(
  matches: readonly Match[],
  sessionId: SessionId,
): Match[] {
  return matches.filter((m) => m.sessionId === sessionId);
}

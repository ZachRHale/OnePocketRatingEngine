import type { PlayerId, SessionId } from "./ids.js";

/**
 * Layer 1 — Raw Match Data.
 *
 * A session is one bounded run of the league — e.g. a 12-week "Spring 2026".
 * Sessions run back to back; each has its own schedule, its own standings, and
 * its own champion. They are the unit at which two things happen:
 *
 *   - **Standings reset.** Each session's win/loss records stand alone.
 *   - **Ratings are published (frozen).** A player's League Rating is frozen at
 *     the START of a session and used for every ball spot that session; it is
 *     only refreshed at the next session boundary. Skill still accumulates
 *     game-by-game underneath — the freeze only controls *when the new number is
 *     applied*. See `frozenRatingsForSession` in Layer 3.
 *
 * Sessions are ordered by {@link index} (1-based). "Rating as of the end of
 * session K" means the engine folded over every match in sessions with a lower
 * index — which is exactly the rating that seeds session K+1.
 */
export interface Session {
  id: SessionId;
  /** Human-facing name, e.g. "Spring 2026". */
  label: string;
  /** 1-based running order. Lower runs earlier; drives rating carryover. */
  index: number;
  /** Scheduled length in weeks. */
  weeks: number;
  /** Roster for this session; may differ from other sessions. */
  playerIds: PlayerId[];
}

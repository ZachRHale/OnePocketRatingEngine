import type { PlayerId, SessionId } from "./ids.js";

/**
 * Layer 1 — Raw Match Data.
 *
 * A session is one bounded run of the league — e.g. a 12-week "Spring 2026".
 * Sessions run back to back; each has its own schedule, its own standings, and
 * its own champion. Their remaining structural role is narrow:
 *
 *   - **Standings reset.** Each session's win/loss records stand alone.
 *   - **Scheduling.** Each session builds its own round-robin (with a per-session
 *     bye rotation).
 *
 * Sessions no longer freeze ratings. Ball spots follow a per-player,
 * every-20-games policy that pays no attention to session boundaries — see
 * `spotRatingsFor` in Layer 3.
 *
 * Sessions are ordered by {@link index} (1-based); lower runs earlier.
 */
export interface Session {
  id: SessionId;
  /** Human-facing name, e.g. "Spring 2026". */
  label: string;
  /** 1-based running order. Lower runs earlier. */
  index: number;
  /** Scheduled length in weeks. */
  weeks: number;
  /** Roster for this session; may differ from other sessions. */
  playerIds: PlayerId[];
}

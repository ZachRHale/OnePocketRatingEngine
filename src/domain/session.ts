import type { DivisionId, PlayerId, SessionId } from "./ids.js";

/**
 * Layer 1 — Raw Match Data.
 *
 * One division within a {@link Session}: a subset of the session roster that
 * runs its own round-robin and its own standings race. Divisions exist to keep
 * a large roster from needing an impractically long schedule — two divisions of
 * nine and eight complete a full round-robin in nine weeks, where a single
 * seventeen-player league would need seventeen.
 *
 * A division is *not* a rating boundary. Ball spots come from each player's spot
 * rating, which is global and ignores divisions entirely (see `spotRatingsFor`),
 * so a cross-division playoff match is handicapped correctly with no special
 * handling.
 */
export interface Division {
  /** Short handle, unique within its session, e.g. `"a"`. */
  id: DivisionId;
  /** Human-facing name, e.g. "Division A". */
  label: string;
  /** The players in this division. Disjoint from the session's other divisions. */
  playerIds: PlayerId[];
}

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
 *   - **Divisions.** A session may split its roster into {@link Division}s, each
 *     running its own round-robin and its own standings race.
 *
 * Sessions no longer freeze ratings. Ball spots follow a per-player,
 * every-10-games policy that pays no attention to session boundaries — see
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
  /**
   * The session's divisions, if it is split. **Empty means undivided** — one
   * roster, one standings race — which is the shape of a playoff session or a
   * small league.
   *
   * Divisions are deliberately per-session rather than a property of a player:
   * they are re-drafted every session, so a player's division is a fact about
   * *this* run of the league, not about the player.
   */
  divisions: Division[];
}

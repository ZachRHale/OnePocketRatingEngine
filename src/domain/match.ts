import type { MatchId, PlayerId, SessionId } from "./ids.js";
import type { BallSpot } from "./ballSpot.js";
import type { Game } from "./game.js";

/**
 * Every match is a race to this many game wins. This is a league rule, kept as
 * a named constant rather than a magic number; it is recorded on each match so
 * historical data stays self-describing if the rule ever changes.
 */
export const RACE_TO_GAMES = 3;

/** Games won by each side. e.g. a 3-2 match is `{ home: 3, away: 2 }`. */
export interface MatchScore {
  home: number;
  away: number;
}

/**
 * Layer 1 — Raw Match Data.
 *
 * A completed match between two players. Immutable once recorded. `home` and
 * `away` correspond to "Player A" and "Player B"; the naming is neutral and
 * carries no venue meaning.
 *
 * `winner` and `score` are stored explicitly even though they are derivable
 * from `games`: they are facts as reported, and persisting them lets the store
 * validate that the game log agrees with the reported result.
 */
export interface Match {
  id: MatchId;
  date: Date;

  /** The session this match belongs to. Standings and scheduling scope to it. */
  sessionId: SessionId;
  /** Week number WITHIN the session (1-based), not an all-time counter. */
  week: number;

  home: PlayerId;
  away: PlayerId;

  /** The ball spot applied to every game in this match. */
  ballSpot: BallSpot;

  winner: PlayerId;
  score: MatchScore;

  /** Race target in effect for this match; defaults to {@link RACE_TO_GAMES}. */
  raceToGames: number;

  /**
   * A forfeit: the result was AWARDED, not played. `winner` took the match by
   * default (a no-show, withdrawal, etc.) and `score` is the full race
   * (`raceToGames`–0) in their favor. Critically, `games` is EMPTY: no balls
   * were pocketed. Because ratings and the ball-spot clock are driven purely by
   * games, a forfeit moves neither — it counts in the standings (a win and a
   * loss) but never touches a handicap or a rating. Absent/false on a played
   * match.
   */
  forfeit?: boolean;

  /**
   * Every game played, in order. Preserved permanently. Empty for a
   * {@link forfeit}, which awards the match without any games being played.
   */
  games: Game[];
}

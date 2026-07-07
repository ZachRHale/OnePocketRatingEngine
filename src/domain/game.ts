import type { GameId, MatchId, PlayerId } from "./ids.js";
import type { BallSpot } from "./ballSpot.js";

/**
 * Layer 1 — Raw Match Data.
 *
 * A single game within a match. Games are immutable facts and are preserved
 * permanently: the store never overwrites or discards a played game. This is
 * the finest-grained record the rating engine can consume — it captures not
 * just who won, but the margin (balls made vs. the target for the game).
 */
export interface Game {
  id: GameId;
  matchId: MatchId;
  /** 1-based position of this game within the match. */
  gameNumber: number;

  /**
   * The per-game target for each side, i.e. the match's ball spot copied onto
   * the game. Stored per game (rather than only on the match) so a game record
   * is self-describing and immutable even if a future match's spot were
   * corrected.
   */
  target: BallSpot;

  /** Balls actually pocketed by each side in this game. */
  ballsMade: {
    home: number;
    away: number;
  };

  /** Winner of this game. */
  winner: PlayerId;

  // --- Future optional fields (see README). Absent today; the store should
  //     round-trip them untouched once populated. ---
  breakWinner?: PlayerId;
  innings?: number;
  /** Duration in seconds. */
  time?: number;
  fouls?: { home: number; away: number };
  safeties?: { home: number; away: number };
}

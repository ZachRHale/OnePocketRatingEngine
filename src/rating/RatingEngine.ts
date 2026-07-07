import type { Match, Player, PlayerId } from "../domain/index.js";

/**
 * Layer 2 — Rating Engine.
 *
 * The one derived value the engine produces for a player. This is the shape the
 * rest of the app depends on; individual engines are free to compute the
 * numbers however they like, as long as they return this.
 */
export interface PlayerRating {
  playerId: PlayerId;

  /** The authoritative one-pocket rating. */
  leagueRating: number;

  /**
   * How much to trust this rating, 0..1. Grows with games played. Informs (but
   * is distinct from) `provisional`.
   */
  confidence: number;

  /** True while the rating is not yet trustworthy enough for full standing. */
  provisional: boolean;

  /**
   * Recent net movement, e.g. +15, +4, 0, -6. Informational only — the league
   * never makes decisions from it.
   */
  trend: number;

  gamesPlayed: number;
}

/**
 * Everything an engine is allowed to read. It gets the players (for identity
 * and Fargo seeds) and the full, ordered match history. Deliberately the ONLY
 * input: an engine cannot reach into the database, the league, or global state.
 */
export interface RatingInput {
  players: readonly Player[];
  /** Full history. Order matters — most engines are path-dependent. */
  matches: readonly Match[];
}

/**
 * Layer 2 — Rating Engine.
 *
 * The seam that keeps the rating algorithm OUT of the data model and the league
 * logic. Swap in a smarter engine later without touching Layer 1 or Layer 3;
 * run several engines side by side to compare them; recompute every rating from
 * history at any time. That flexibility is the whole point of this interface.
 *
 * Implementations must be pure with respect to their input: given the same
 * {@link RatingInput} they return the same result and never mutate it.
 */
export interface RatingEngine {
  /** Stable identifier, useful when comparing engines. e.g. "simple-provisional". */
  readonly name: string;

  /**
   * Produce a rating for every player in `input.players`. Players with no
   * matches still get an entry (seeded from Fargo, provisional).
   */
  calculateRatings(input: RatingInput): PlayerRating[];
}

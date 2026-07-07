import type { BallSpot } from "../domain/index.js";

/**
 * Layer 3 — League Logic.
 *
 * One row of a handicap table: for a rating gap at or above `minGap` (and below
 * the next tier's `minGap`), the stronger player must pocket `stronger` balls
 * and the weaker player `weaker` balls per game.
 */
export interface HandicapTier {
  /** Inclusive lower bound of the rating gap this tier applies to. */
  minGap: number;
  /** Balls the STRONGER (higher-rated) player must pocket to win a game. */
  stronger: number;
  /** Balls the WEAKER (lower-rated) player must pocket to win a game. */
  weaker: number;
}

/**
 * Default ball-spot ladder. Tuned so the spot widens as the rating gap grows,
 * matching the philosophy's examples (8-8 → 8-7 → 8-6 → 8-5 → 9-5 → 10-5).
 * A league can supply its own table; this is only a starting point and is a
 * prime candidate for the "analyze whether a handicap table is fair" tooling.
 */
export const DEFAULT_HANDICAP_TABLE: readonly HandicapTier[] = [
  { minGap: 0, stronger: 8, weaker: 8 },
  { minGap: 26, stronger: 8, weaker: 7 },
  { minGap: 76, stronger: 8, weaker: 6 },
  { minGap: 151, stronger: 8, weaker: 5 },
  { minGap: 251, stronger: 9, weaker: 5 },
  { minGap: 351, stronger: 10, weaker: 5 },
];

/**
 * Validates a table and returns it sorted by `minGap` ascending. Throws if it
 * is empty or lacks a `minGap: 0` tier (every gap must map to a spot).
 */
export function normalizeHandicapTable(
  table: readonly HandicapTier[],
): HandicapTier[] {
  if (table.length === 0) {
    throw new Error("Handicap table must have at least one tier");
  }
  const sorted = [...table].sort((a, b) => a.minGap - b.minGap);
  if (sorted[0]!.minGap !== 0) {
    throw new Error("Handicap table must include a tier with minGap: 0");
  }
  return sorted;
}

/**
 * Picks the tier for a rating gap: the tier with the largest `minGap` not
 * exceeding `gap`. `table` must be sorted ascending (see
 * {@link normalizeHandicapTable}). `gap` must be non-negative.
 */
export function tierForGap(
  table: readonly HandicapTier[],
  gap: number,
): HandicapTier {
  let chosen = table[0]!;
  for (const tier of table) {
    if (tier.minGap <= gap) {
      chosen = tier;
    } else {
      break;
    }
  }
  return chosen;
}

/**
 * Resolves the ball spot for a matchup given each side's rating. `home` and
 * `away` are the two players' ratings; the returned {@link BallSpot} is
 * oriented to home/away (the stronger side gets the higher target).
 */
export function ballSpotForRatings(
  table: readonly HandicapTier[],
  homeRating: number,
  awayRating: number,
): BallSpot {
  const tier = tierForGap(table, Math.abs(homeRating - awayRating));
  return homeRating >= awayRating
    ? { home: tier.stronger, away: tier.weaker }
    : { home: tier.weaker, away: tier.stronger };
}

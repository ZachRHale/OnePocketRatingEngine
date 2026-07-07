/**
 * Layer 1 — Raw Match Data.
 *
 * A ball spot is the handicap in one-pocket: the number of balls each side must
 * pocket to WIN A SINGLE GAME. It is emphatically NOT the number of games
 * needed to win the match — every match is a race to {@link RACE_TO_GAMES}
 * games, and the same ball spot is applied to every game within a match.
 *
 * Examples (stronger player listed first):
 *   8-8  equal players
 *   8-7  small difference
 *   8-6  larger difference
 *   8-5  larger still
 *   9-5, 10-5, ...  eventually the stronger player's target climbs
 */
export interface BallSpot {
  /** Balls the home player must pocket to win a game. */
  home: number;
  /** Balls the away player must pocket to win a game. */
  away: number;
}

/**
 * Signed spot from the home player's perspective: positive means the home
 * player must pocket more balls (i.e. home is the favored/stronger side and is
 * giving weight to away). Zero means an even spot.
 */
export function homeSpotAdvantage(spot: BallSpot): number {
  return spot.home - spot.away;
}

/** Renders a spot in the conventional "8-7" notation. */
export function formatBallSpot(spot: BallSpot): string {
  return `${spot.home}-${spot.away}`;
}

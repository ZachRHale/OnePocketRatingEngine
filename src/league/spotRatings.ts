import type { Match, Player, PlayerId } from "../domain/index.js";
import type { PlayerRating, RatingEngine } from "../rating/index.js";

/**
 * Layer 3 — League Logic.
 *
 * **Ball-spot rating policy: per-player, refreshed every 20 games.**
 *
 * A player's *spot rating* — the number that sets their ball spots — is frozen
 * at their most recent 20-game boundary and only steps forward when they finish
 * another 20 games. It is NOT the live rating (which moves after every game),
 * and it is NOT frozen for a whole session. Between a player's boundaries the
 * spot holds steady, so a spot never shifts in the middle of a stretch of play;
 * it re-bases in a single step once enough new evidence is in.
 *
 * This is the deliberate reversal of the old "freeze per session" policy. Its
 * purpose: starting Fargo seeds are often well off a player's true one-pocket
 * speed, so a player's handicap is corrected during the season — after their
 * first 20 games and every 20 thereafter — instead of being locked in until the
 * next session boundary. The tradeoff is that a full season of spots can no
 * longer be published up front; only spots up to each player's next boundary are
 * settled.
 *
 * The cadence is intentionally the same 20 games as
 * `SimpleProvisionalRatingEngine`'s provisional threshold: a player's spot first
 * moves off their Fargo seed exactly when they stop being provisional.
 */

/** Games a player must complete before their spot rating re-bases. */
export const SPOT_REFRESH_GAMES = 20;

/**
 * Each player's **spot rating**: their rating as of the most recent match that
 * pushed their game count across a {@link SPOT_REFRESH_GAMES} boundary, using
 * `matches` as the shared history. Before a player's first boundary the cut is
 * empty, so they sit at their Fargo seed (provisional) — exactly the intended
 * behavior for someone with fewer than 20 games on record.
 *
 * Every player carries their *own* cut, so a matchup's spot blends two snapshots
 * that may have been taken at different points in the season. The engine is run
 * once per distinct cut (at most one per player), never mutated, and folded only
 * over a prefix of `matches` — the ball spots on those prefix matches are
 * whatever policy already assigned them, so the computation stays causal.
 *
 * @param blockSize Games between refreshes. Defaults to {@link SPOT_REFRESH_GAMES}.
 */
export function spotRatingsFor(
  engine: RatingEngine,
  players: readonly Player[],
  matches: readonly Match[],
  blockSize: number = SPOT_REFRESH_GAMES,
): PlayerRating[] {
  if (!Number.isInteger(blockSize) || blockSize <= 0) {
    throw new RangeError(
      `blockSize must be a positive integer, got ${blockSize}`,
    );
  }

  // Walk the history once to find, for each player, how many matches to fold
  // over: the prefix ending at the match that last crossed a block boundary.
  const gamesSoFar = new Map<PlayerId, number>();
  const lastBlock = new Map<PlayerId, number>();
  const cut = new Map<PlayerId, number>();
  for (const p of players) {
    gamesSoFar.set(p.id, 0);
    lastBlock.set(p.id, 0);
    cut.set(p.id, 0);
  }

  matches.forEach((match, i) => {
    for (const id of [match.home, match.away]) {
      if (!gamesSoFar.has(id)) continue; // non-roster; the engine would reject it
      const after = gamesSoFar.get(id)! + match.games.length;
      gamesSoFar.set(id, after);
      const block = Math.floor(after / blockSize);
      if (block > lastBlock.get(id)!) {
        lastBlock.set(id, block);
        cut.set(id, i + 1); // include matches[0..i]
      }
    }
  });

  // Fold the engine once per distinct cut, then read each player at their own.
  const snapshots = new Map<number, Map<PlayerId, PlayerRating>>();
  for (const c of new Set(cut.values())) {
    const ratings = engine.calculateRatings({
      players,
      matches: matches.slice(0, c),
    });
    snapshots.set(c, new Map(ratings.map((r) => [r.playerId, r])));
  }

  return players.map((p) => snapshots.get(cut.get(p.id)!)!.get(p.id)!);
}

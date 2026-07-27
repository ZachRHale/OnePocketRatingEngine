import { describe, it, expect } from "vitest";
import {
  SimpleProvisionalRatingEngine,
  SPOT_REFRESH_GAMES,
  spotRatingsFor,
  type PlayerRating,
} from "../../src/index.js";
import { match, player, wins } from "../factories.js";

const engine = new SimpleProvisionalRatingEngine();
const players = [player("a", 500), player("b", 500)];

const ratingOf = (rs: PlayerRating[], id: string) =>
  rs.find((r) => r.playerId === id)!;

/** `n` back-to-back 3-game matches, all swept by "a". Each match = 3 games. */
const sweeps = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    match({ id: `m${i + 1}`, home: "a", away: "b", games: wins("a", 3) }),
  );

describe("spotRatingsFor", () => {
  it("exposes the 10-game refresh cadence", () => {
    expect(SPOT_REFRESH_GAMES).toBe(10);
  });

  it("holds a player at their Fargo seed until their first 10 games", () => {
    // 3 matches = 9 games each, short of the 10-game boundary.
    const spot = spotRatingsFor(engine, players, sweeps(3));
    expect(ratingOf(spot, "a").leagueRating).toBe(500);
    expect(ratingOf(spot, "a").gamesPlayed).toBe(0);
    expect(ratingOf(spot, "a").provisional).toBe(true);
  });

  it("re-bases at the boundary and ignores games played since", () => {
    // 6 matches = 18 games. "a" crosses the first 10-game boundary on match 4
    // (12 games); matches 5–6 are AFTER it and must not move the spot.
    const all = sweeps(6);
    const spot = spotRatingsFor(engine, players, all);

    // The spot equals the live rating frozen at the crossing match (the 4th).
    const atBoundary = engine.calculateRatings({
      players,
      matches: all.slice(0, 4),
    });
    expect(ratingOf(spot, "a").leagueRating).toBe(
      ratingOf(atBoundary, "a").leagueRating,
    );
    expect(ratingOf(spot, "a").gamesPlayed).toBe(12);
    expect(ratingOf(spot, "a").provisional).toBe(false);

    // The spot lags the live rating: "a" kept winning after the boundary.
    const live = engine.calculateRatings({ players, matches: all });
    expect(ratingOf(spot, "a").leagueRating).toBeGreaterThan(500);
    expect(ratingOf(live, "a").leagueRating).toBeGreaterThan(
      ratingOf(spot, "a").leagueRating,
    );
  });

  it("with blockSize 3 every match is a boundary, so the spot tracks live", () => {
    const all = sweeps(10);
    const spot = spotRatingsFor(engine, players, all, 3);
    const live = engine.calculateRatings({ players, matches: all });
    expect(ratingOf(spot, "a").leagueRating).toBe(
      ratingOf(live, "a").leagueRating,
    );
  });

  it("rejects a non-positive or non-integer blockSize", () => {
    expect(() => spotRatingsFor(engine, players, [], 0)).toThrow(/blockSize/);
    expect(() => spotRatingsFor(engine, players, [], -1)).toThrow(/blockSize/);
    expect(() => spotRatingsFor(engine, players, [], 2.5)).toThrow(/blockSize/);
  });
});

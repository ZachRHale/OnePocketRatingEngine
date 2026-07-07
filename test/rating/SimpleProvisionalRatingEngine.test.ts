import { describe, it, expect } from "vitest";
import {
  SimpleProvisionalRatingEngine,
  type PlayerRating,
} from "../../src/index.js";
import { match, player, win, wins } from "../factories.js";
import {
  ballSpotForRatings,
  DEFAULT_HANDICAP_TABLE,
} from "../../src/league/index.js";

const engine = () => new SimpleProvisionalRatingEngine();

function ratingOf(ratings: PlayerRating[], id: string): PlayerRating {
  const r = ratings.find((x) => x.playerId === id);
  if (!r) throw new Error(`no rating for ${id}`);
  return r;
}

describe("SimpleProvisionalRatingEngine", () => {
  describe("constructor validation", () => {
    it("rejects non-positive kFactor", () => {
      expect(() => new SimpleProvisionalRatingEngine({ kFactor: 0 })).toThrow(
        RangeError,
      );
    });
    it("rejects non-finite pointsPerBall", () => {
      expect(
        () => new SimpleProvisionalRatingEngine({ pointsPerBall: NaN }),
      ).toThrow(RangeError);
    });
  });

  describe("expectedScore", () => {
    it("is 0.5 for equal ratings and symmetric", () => {
      const e = engine();
      expect(e.expectedScore(500, 500)).toBeCloseTo(0.5, 10);
      expect(e.expectedScore(700, 300) + e.expectedScore(300, 700)).toBeCloseTo(
        1,
        10,
      );
    });
    it("favors the higher-rated player", () => {
      expect(engine().expectedScore(800, 400)).toBeGreaterThan(0.9);
    });
  });

  describe("seeding with no matches", () => {
    it("seeds League Rating from Fargo, provisional, zero games", () => {
      const ratings = engine().calculateRatings({
        players: [player("a", 506), player("b", 450)],
        matches: [],
      });
      const a = ratingOf(ratings, "a");
      expect(a.leagueRating).toBe(506);
      expect(a.provisional).toBe(true);
      expect(a.confidence).toBe(0);
      expect(a.gamesPlayed).toBe(0);
      expect(a.trend).toBe(0);
    });

    it("does not mutate the input players", () => {
      const players = [player("a", 506)];
      engine().calculateRatings({ players, matches: [] });
      expect(players[0]!.leagueRating).toBe(506);
    });

    it("is deterministic", () => {
      const players = [player("a", 506), player("b", 450)];
      const matches = [
        match({
          id: "m1",
          home: "a",
          away: "b",
          games: [...wins("a", 3), ...wins("b", 1)],
        }),
      ];
      const first = engine().calculateRatings({ players, matches });
      const second = engine().calculateRatings({ players, matches });
      expect(first).toEqual(second);
    });
  });

  describe("game-level updates", () => {
    it("raises the winner and lowers the loser, zero-sum for equal players", () => {
      const players = [player("a", 500), player("b", 500)];
      const ratings = engine().calculateRatings({
        players,
        matches: [
          match({ id: "m1", home: "a", away: "b", games: wins("a", 3) }),
        ],
      });
      const a = ratingOf(ratings, "a");
      const b = ratingOf(ratings, "b");
      expect(a.leagueRating).toBeGreaterThan(500);
      expect(b.leagueRating).toBeLessThan(500);
      // Even spot + equal ratings => symmetric movement.
      expect(a.leagueRating - 500).toBe(500 - b.leagueRating);
    });

    it("uses individual game results, not just the match winner", () => {
      // Winning 3-0 must raise the rating more than winning 3-2.
      const sweep = engine().calculateRatings({
        players: [player("a", 500), player("b", 500)],
        matches: [
          match({ id: "m", home: "a", away: "b", games: wins("a", 3) }),
        ],
      });
      const grind = engine().calculateRatings({
        players: [player("a", 500), player("b", 500)],
        matches: [
          match({
            id: "m",
            home: "a",
            away: "b",
            games: [...wins("a", 3), ...wins("b", 2)],
          }),
        ],
      });
      expect(ratingOf(sweep, "a").leagueRating).toBeGreaterThan(
        ratingOf(grind, "a").leagueRating,
      );
    });
  });

  describe("ball spot expectation", () => {
    it("rewards a win less when the spot already favors the winner", () => {
      // Equal ratings. When home has the ball advantage (fewer balls to win),
      // winning is expected, so the rating gain is smaller than at an even spot.
      const favored = engine().calculateRatings({
        players: [player("a", 500), player("b", 500)],
        matches: [
          match({
            id: "m",
            home: "a",
            away: "b",
            ballSpot: { home: 6, away: 8 }, // home needs fewer balls => favored
            games: wins("a", 3),
          }),
        ],
      });
      const even = engine().calculateRatings({
        players: [player("a", 500), player("b", 500)],
        matches: [
          match({
            id: "m",
            home: "a",
            away: "b",
            ballSpot: { home: 8, away: 8 },
            games: wins("a", 3),
          }),
        ],
      });
      const favoredGain = ratingOf(favored, "a").leagueRating - 500;
      const evenGain = ratingOf(even, "a").leagueRating - 500;
      expect(favoredGain).toBeGreaterThan(0);
      expect(favoredGain).toBeLessThan(evenGain);
    });
  });

  describe("margin of victory", () => {
    const oneGame = (loserBalls: number) =>
      match({ id: "m", home: "a", away: "b", games: [win("a", loserBalls)] });

    it("moves ratings more for a shutout than a hill-hill win", () => {
      const players = () => [player("a", 500), player("b", 500)];
      const shutout = engine().calculateRatings({
        players: players(),
        matches: [oneGame(0)], // loser made 0 of 8
      });
      const nailBiter = engine().calculateRatings({
        players: players(),
        matches: [oneGame(7)], // loser made 7 of 8
      });
      expect(ratingOf(shutout, "a").leagueRating).toBeGreaterThan(
        ratingOf(nailBiter, "a").leagueRating,
      );
    });

    it("ignores margin entirely when marginWeight is 0", () => {
      const eng = new SimpleProvisionalRatingEngine({ marginWeight: 0 });
      const players = () => [player("a", 500), player("b", 500)];
      const shutout = eng.calculateRatings({
        players: players(),
        matches: [oneGame(0)],
      });
      const nailBiter = eng.calculateRatings({
        players: players(),
        matches: [oneGame(7)],
      });
      expect(ratingOf(shutout, "a").leagueRating).toBe(
        ratingOf(nailBiter, "a").leagueRating,
      );
    });

    it("rejects a marginWeight outside [0, 1]", () => {
      expect(
        () => new SimpleProvisionalRatingEngine({ marginWeight: 1.5 }),
      ).toThrow(RangeError);
      expect(
        () => new SimpleProvisionalRatingEngine({ marginWeight: -0.1 }),
      ).toThrow(RangeError);
    });
  });

  describe("games played, confidence, provisional", () => {
    it("counts individual games and scales confidence linearly", () => {
      const ratings = new SimpleProvisionalRatingEngine({
        confidenceGames: 50,
      }).calculateRatings({
        players: [player("a", 500), player("b", 500)],
        matches: [
          match({
            id: "m",
            home: "a",
            away: "b",
            games: [...wins("a", 3), ...wins("b", 2)],
          }),
        ],
      });
      const a = ratingOf(ratings, "a");
      expect(a.gamesPlayed).toBe(5); // 3-2 match => 5 games
      expect(a.confidence).toBeCloseTo(0.1, 10); // 5 / 50
    });

    it("clears provisional once games played reaches the threshold", () => {
      const eng = new SimpleProvisionalRatingEngine({ provisionalGames: 3 });
      const ratings = eng.calculateRatings({
        players: [player("a", 500), player("b", 500)],
        matches: [
          match({ id: "m", home: "a", away: "b", games: wins("a", 3) }),
        ],
      });
      expect(ratingOf(ratings, "a").gamesPlayed).toBe(3);
      expect(ratingOf(ratings, "a").provisional).toBe(false);
    });
  });

  describe("trend", () => {
    it("is positive for a player on a winning run", () => {
      const players = [player("a", 500), player("b", 500)];
      const matches = [
        match({
          id: "m1",
          home: "a",
          away: "b",
          games: [...wins("a", 3), ...wins("b", 1)],
        }),
        match({ id: "m2", home: "a", away: "b", games: wins("a", 3) }),
      ];
      const a = ratingOf(engine().calculateRatings({ players, matches }), "a");
      expect(a.trend).toBeGreaterThan(0);
    });
  });

  describe("data validation", () => {
    it("throws on a self-match", () => {
      expect(() =>
        engine().calculateRatings({
          players: [player("a")],
          matches: [
            match({ id: "m", home: "a", away: "a", games: [win("a")] }),
          ],
        }),
      ).toThrow(/cannot play themselves/);
    });

    it("throws when a match references an unknown player", () => {
      expect(() =>
        engine().calculateRatings({
          players: [player("a")],
          matches: [
            match({ id: "m", home: "a", away: "ghost", games: [win("a")] }),
          ],
        }),
      ).toThrow(/unknown player/);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CsvLeagueStore,
  SimpleProvisionalRatingEngine,
  agreedSpotFor,
} from "../../src/index.js";

/**
 * Agreed spots: a ball spot the players settle on instead of the ratings' (e.g.
 * "play this one even" for an underrated player). On the game log it is a
 * recorded fact the match is spotted from; on the schedule it is an
 * announcement the store reads back but never applies to a result by itself.
 */
describe("CsvLeagueStore agreed spots", () => {
  let dir: string;

  // A 150-point gap: the ratings alone would spot this 8-6 (see the ladder).
  const PLAYERS =
    ["id,fargo,name", "a,600,Ada", "b,450,Ben", "c,500,Cal"].join("\n") + "\n";
  const HEADER =
    "session,matchId,week,home,away,winner,loserBalls,forfeit,spotHome,spotAway";

  const writeGames = (rows: string[]) =>
    writeFileSync(join(dir, "games.csv"), [HEADER, ...rows].join("\n") + "\n", "utf8");
  const writeSchedule = (header: string, rows: string[]) =>
    writeFileSync(join(dir, "schedule.csv"), [header, ...rows].join("\n") + "\n", "utf8");
  const load = () => new CsvLeagueStore(dir).load();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "league-agreed-"));
    writeFileSync(join(dir, "players.csv"), PLAYERS, "utf8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips an agreed spot and uses it instead of the ratings", () => {
    const store = new CsvLeagueStore(dir);
    store.appendMatch({
      sessionId: "s1",
      week: 1,
      home: "a",
      away: "b",
      games: [
        { winner: "a", loserBalls: 7 },
        { winner: "a", loserBalls: 7 },
        { winner: "a", loserBalls: 7 },
      ],
      agreedSpot: { home: 8, away: 8 },
    });

    const lines = readFileSync(join(dir, "games.csv"), "utf8").trim().split("\n");
    expect(lines[1]).toBe("s1,s1-w1-1,1,a,b,a,7,0,8,8");

    const m = store.load().matches[0]!;
    expect(m.ballSpot).toEqual({ home: 8, away: 8 });
    expect(m.spotAgreed).toBe(true);
    // The loser's ball count is read against their agreed target of 8.
    expect(m.games[0]!.target).toEqual({ home: 8, away: 8 });
  });

  it("leaves a match with blank spot cells rating-derived", () => {
    writeGames(["s1,m1,1,a,b,a,2,0,,", "s1,m1,1,a,b,a,2,0,,", "s1,m1,1,a,b,a,2,0,,"]);
    const m = load().matches[0]!;
    expect(m.ballSpot).toEqual({ home: 8, away: 6 });
    expect(m.spotAgreed).toBeUndefined();
  });

  it("moves ratings differently than the same games at the derived spot", () => {
    // Ben (underdog) sweeps Ada. Giving Ben weight (8-6) makes that less
    // surprising than doing it even (8-8), so the even match must credit more.
    const rows = (spot: string) =>
      [1, 2, 3].map(() => `s1,m1,1,a,b,b,5,0,${spot}`);
    const engine = new SimpleProvisionalRatingEngine();
    const ben = (spot: string): number => {
      writeGames(rows(spot));
      const { players, matches } = load();
      return engine
        .calculateRatings({ players, matches })
        .find((r) => r.playerId === "b")!.leagueRating;
    };
    expect(ben("8,8")).toBeGreaterThan(ben(","));
  });

  it("rejects a half-filled spot", () => {
    writeGames(["s1,m1,1,a,b,a,2,0,8,"]);
    expect(() => load()).toThrow(/both spotHome and spotAway/);
  });

  it("rejects different spots across one match's rows", () => {
    writeGames(["s1,m1,1,a,b,a,2,0,8,8", "s1,m1,1,a,b,a,2,0,8,7"]);
    expect(() => load()).toThrow(/different spotHome\/spotAway/);
  });

  it("rejects a spot on a forfeit", () => {
    writeGames(["s1,m1,1,a,b,a,0,1,8,8"]);
    expect(() => load()).toThrow(/cannot carry a spot/);
    expect(() =>
      new CsvLeagueStore(dir).appendMatch({
        sessionId: "s1",
        week: 2,
        home: "a",
        away: "b",
        games: [],
        forfeit: true,
        forfeitWinner: "a",
        agreedSpot: { home: 8, away: 8 },
      }),
    ).toThrow(/cannot carry a spot/);
  });

  it("rejects a non-positive or fractional spot", () => {
    writeGames(["s1,m1,1,a,b,a,2,0,8,0"]);
    expect(() => load()).toThrow(/at least 1/);
    writeGames(["s1,m1,1,a,b,a,2,0,8,7.5"]);
    expect(() => load()).toThrow(/at least 1/);
  });

  describe("on the schedule", () => {
    const WITH_SPOT = "session,week,home,away,spotHome,spotAway";

    it("reads an agreed spot and leaves other fixtures without one", () => {
      writeSchedule(WITH_SPOT, ["s1,1,a,b,8,8", "s1,2,a,c,,"]);
      expect(load().schedule).toEqual([
        { sessionId: "s1", week: 1, home: "a", away: "b", agreedSpot: { home: 8, away: 8 } },
        { sessionId: "s1", week: 2, home: "a", away: "c" },
      ]);
    });

    it("finds the spot by pair and flips it to follow swapped seats", () => {
      writeSchedule(WITH_SPOT, ["s1,1,a,b,9,8"]);
      const { schedule } = load();
      expect(agreedSpotFor(schedule, "s1", 1, "a", "b")).toEqual({ home: 9, away: 8 });
      expect(agreedSpotFor(schedule, "s1", 1, "b", "a")).toEqual({ home: 8, away: 9 });
      expect(agreedSpotFor(schedule, "s1", 2, "a", "b")).toBeUndefined();
      expect(agreedSpotFor(schedule, "s2", 1, "a", "b")).toBeUndefined();
    });

    it("does not spot a result by itself", () => {
      // The schedule is a plan: only the spot written with the games counts.
      writeSchedule(WITH_SPOT, ["s1,1,a,b,8,8"]);
      writeGames(["s1,m1,1,a,b,a,2,0,,", "s1,m1,1,a,b,a,2,0,,", "s1,m1,1,a,b,a,2,0,,"]);
      expect(load().matches[0]!.ballSpot).toEqual({ home: 8, away: 6 });
    });

    it("keeps agreed spots on sessions a regenerate does not touch", () => {
      writeSchedule(WITH_SPOT, ["s1,1,a,b,8,8", "s2,1,a,c,,"]);
      new CsvLeagueStore(dir).replaceSchedule("s2", [
        { sessionId: "s2", week: 1, home: "b", away: "c" },
      ]);
      const raw = readFileSync(join(dir, "schedule.csv"), "utf8").trim().split("\n");
      expect(raw).toEqual([WITH_SPOT, "s1,1,a,b,8,8", "s2,1,b,c,,"]);
    });

    it("drops the spot columns once no fixture needs them", () => {
      writeSchedule(WITH_SPOT, ["s1,1,a,b,8,8"]);
      new CsvLeagueStore(dir).replaceSchedule("s1", [
        { sessionId: "s1", week: 1, home: "a", away: "c" },
      ]);
      const raw = readFileSync(join(dir, "schedule.csv"), "utf8").trim().split("\n");
      expect(raw).toEqual(["session,week,home,away", "s1,1,a,c"]);
    });
  });
});

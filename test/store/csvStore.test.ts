import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CsvLeagueStore,
  SimpleProvisionalRatingEngine,
  computePlayerRecords,
} from "../../src/index.js";

/**
 * Exercises the real append-only persistence path, focusing on forfeits and the
 * backward-compatible `forfeit` column: a forfeit is one row, it round-trips as
 * a games-less match, and a legacy log (no `forfeit` column) upgrades on append.
 */
describe("CsvLeagueStore forfeits", () => {
  let dir: string;

  const PLAYERS = ["id,fargo,name", "a,506,Ada", "b,450,Ben"].join("\n") + "\n";
  const LEGACY_GAMES_HEADER = "session,matchId,week,home,away,winner,loserBalls";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "league-store-"));
    writeFileSync(join(dir, "players.csv"), PLAYERS, "utf8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a forfeit as a games-less awarded match", () => {
    const store = new CsvLeagueStore(dir);
    store.appendMatch({
      sessionId: "spring-2026",
      week: 1,
      home: "a",
      away: "b",
      games: [],
      forfeit: true,
      forfeitWinner: "a",
    });

    const { matches } = store.load();
    expect(matches).toHaveLength(1);
    const m = matches[0]!;
    expect(m.forfeit).toBe(true);
    expect(m.winner).toBe("a");
    expect(m.games).toHaveLength(0);
    expect(m.score).toEqual({ home: 3, away: 0 });
  });

  it("upgrades a legacy log (no forfeit column) in place on append", () => {
    // A pre-existing log written before forfeits existed.
    writeFileSync(
      join(dir, "games.csv"),
      [LEGACY_GAMES_HEADER, "spring-2026,sp-w1-1,1,a,b,a,2"].join("\n") + "\n",
      "utf8",
    );

    const store = new CsvLeagueStore(dir);
    store.appendMatch({
      sessionId: "spring-2026",
      week: 1,
      home: "a",
      away: "b",
      games: [],
      forfeit: true,
      forfeitWinner: "b",
    });

    const raw = readFileSync(join(dir, "games.csv"), "utf8");
    const lines = raw.trim().split("\n");
    // Header gained the column; the legacy row was backfilled with forfeit=0.
    expect(lines[0]).toBe(`${LEGACY_GAMES_HEADER},forfeit`);
    expect(lines[1]).toBe("spring-2026,sp-w1-1,1,a,b,a,2,0");
    expect(lines[2]!.endsWith(",1")).toBe(true); // the appended forfeit row

    // And it still loads: one played game + one forfeit, both intact.
    const { matches } = store.load();
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => Boolean(m.forfeit))).toEqual([false, true]);
  });

  it("reads a legacy log with no forfeit column as all played", () => {
    writeFileSync(
      join(dir, "games.csv"),
      [
        LEGACY_GAMES_HEADER,
        "spring-2026,sp-w1-1,1,a,b,a,0",
        "spring-2026,sp-w1-1,1,a,b,a,1",
        "spring-2026,sp-w1-1,1,a,b,a,2",
      ].join("\n") + "\n",
      "utf8",
    );
    const { matches } = new CsvLeagueStore(dir).load();
    expect(matches).toHaveLength(1);
    expect(matches[0]!.forfeit).toBeFalsy();
    expect(matches[0]!.games).toHaveLength(3);
  });

  it("rejects a forfeit whose winner is neither player", () => {
    const store = new CsvLeagueStore(dir);
    expect(() =>
      store.appendMatch({
        sessionId: "spring-2026",
        week: 1,
        home: "a",
        away: "b",
        games: [],
        forfeit: true,
        forfeitWinner: "ghost",
      }),
    ).toThrow(/must be home or away/);
  });

  it("counts the forfeit in records but not in ratings", () => {
    const store = new CsvLeagueStore(dir);
    store.appendMatch({
      sessionId: "spring-2026",
      week: 1,
      home: "a",
      away: "b",
      games: [],
      forfeit: true,
      forfeitWinner: "a",
    });
    const { players, matches } = store.load();

    const records = computePlayerRecords(matches, ["a", "b"]);
    expect(records.get("a")!.gamesWon).toBe(3);
    expect(records.get("b")!.gamesLost).toBe(3);

    const ratings = new SimpleProvisionalRatingEngine().calculateRatings({
      players,
      matches,
    });
    // Seeds untouched, no games counted.
    expect(ratings.find((r) => r.playerId === "a")!.leagueRating).toBe(506);
    expect(ratings.find((r) => r.playerId === "b")!.leagueRating).toBe(450);
    expect(ratings.find((r) => r.playerId === "a")!.gamesPlayed).toBe(0);
  });
});

/**
 * A loser's ball total can be negative: in one pocket each foul costs a ball, so
 * a player can finish below zero. The store persists that as written and the
 * downstream layers read it back unchanged.
 */
describe("CsvLeagueStore negative loser balls", () => {
  let dir: string;

  const PLAYERS = ["id,fargo,name", "a,506,Ada", "b,450,Ben"].join("\n") + "\n";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "league-store-neg-"));
    writeFileSync(join(dir, "players.csv"), PLAYERS, "utf8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a negative loser total", () => {
    const store = new CsvLeagueStore(dir);
    store.appendMatch({
      sessionId: "spring-2026",
      week: 1,
      home: "a",
      away: "b",
      games: [
        { winner: "a", loserBalls: -2 },
        { winner: "a", loserBalls: 0 },
        { winner: "a", loserBalls: 3 },
      ],
    });

    expect(readFileSync(join(dir, "games.csv"), "utf8")).toContain(",a,-2,0");

    const { matches } = store.load();
    const games = matches[0]!.games;
    expect(games.map((g) => g.ballsMade.away)).toEqual([-2, 0, 3]);
  });

  it("still rejects a fractional loser total", () => {
    const store = new CsvLeagueStore(dir);
    expect(() =>
      store.appendMatch({
        sessionId: "spring-2026",
        week: 1,
        home: "a",
        away: "b",
        games: [{ winner: "a", loserBalls: -1.5 }],
      }),
    ).toThrow(/whole number/);
  });

  it("treats a negative total as at least a shutout for the margin swing", () => {
    const store = new CsvLeagueStore(dir);
    store.appendMatch({
      sessionId: "spring-2026",
      week: 1,
      home: "a",
      away: "b",
      games: [
        { winner: "a", loserBalls: -3 },
        { winner: "a", loserBalls: -3 },
        { winner: "a", loserBalls: -3 },
      ],
    });
    const negative = store.load();

    rmSync(join(dir, "games.csv"));
    const shutoutStore = new CsvLeagueStore(dir);
    shutoutStore.appendMatch({
      sessionId: "spring-2026",
      week: 1,
      home: "a",
      away: "b",
      games: [
        { winner: "a", loserBalls: 0 },
        { winner: "a", loserBalls: 0 },
        { winner: "a", loserBalls: 0 },
      ],
    });
    const shutout = shutoutStore.load();

    const engine = new SimpleProvisionalRatingEngine();
    const ratingFor = (data: typeof negative) =>
      engine
        .calculateRatings(data)
        .find((r) => r.playerId === "a")!.leagueRating;
    // Decisiveness is clamped at 1, so going below zero cannot pay more than a
    // shutout does.
    expect(ratingFor(negative)).toBe(ratingFor(shutout));
  });
});

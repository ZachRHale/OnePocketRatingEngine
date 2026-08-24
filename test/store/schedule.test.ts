import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CsvLeagueStore, buildSchedule, fixturesFor } from "../../src/index.js";

/**
 * Exercises schedule.csv — the one file the store rewrites rather than appends
 * to. The behavior that matters most is the hand-edit round trip: whatever the
 * file says is what loads, and regenerating one session never disturbs another.
 */
describe("CsvLeagueStore schedule", () => {
  let dir: string;

  const PLAYERS =
    ["id,fargo,name", "a,600,Ada", "b,550,Ben", "c,500,Cal", "d,450,Dot"].join(
      "\n",
    ) + "\n";

  const writeSchedule = (body: string[]) =>
    writeFileSync(
      join(dir, "schedule.csv"),
      ["session,week,home,away", ...body].join("\n") + "\n",
      "utf8",
    );

  const load = () => new CsvLeagueStore(dir).load();
  const scheduleFile = () => readFileSync(join(dir, "schedule.csv"), "utf8");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "league-schedule-"));
    writeFileSync(join(dir, "players.csv"), PLAYERS, "utf8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is empty when the file is absent", () => {
    expect(load().schedule).toEqual([]);
  });

  it("reads fixtures in file order", () => {
    writeSchedule(["s1,2,c,d", "s1,1,a,b"]);
    expect(load().schedule).toEqual([
      { sessionId: "s1", week: 2, home: "c", away: "d" },
      { sessionId: "s1", week: 1, home: "a", away: "b" },
    ]);
  });

  it("keeps a hand edit exactly as written", () => {
    // The point of persisting the schedule: the file is authoritative.
    writeSchedule(["s1,1,a,b", "s1,1,c,d"]);
    const before = load().schedule;
    // Someone swaps an opponent by hand.
    writeSchedule(["s1,1,a,c", "s1,1,b,d"]);
    const after = load().schedule;
    expect(before).not.toEqual(after);
    expect(after.map((f) => `${f.home}-${f.away}`)).toEqual(["a-c", "b-d"]);
  });

  it("accepts a week that leaves players out", () => {
    // A hand-edited week can legitimately be short — someone is travelling.
    writeSchedule(["s1,1,a,b"]);
    expect(load().schedule).toHaveLength(1);
  });

  describe("replaceSchedule", () => {
    it("writes fixtures and reads them back", () => {
      const store = new CsvLeagueStore(dir);
      const written = store.replaceSchedule(
        "s1",
        fixturesFor("s1", buildSchedule(["a", "b", "c", "d"], 3)),
      );
      expect(written).toBe(6);
      expect(store.load().schedule).toHaveLength(6);
    });

    it("replaces only the named session, preserving other sessions", () => {
      writeSchedule(["s1,1,a,b", "s2,1,c,d", "s2,2,a,c"]);
      const store = new CsvLeagueStore(dir);
      store.replaceSchedule("s1", [
        { sessionId: "s1", week: 1, home: "a", away: "c" },
      ]);
      const schedule = store.load().schedule;
      // s2's two fixtures survive untouched; s1's single row is the new one.
      expect(schedule.filter((f) => f.sessionId === "s2")).toEqual([
        { sessionId: "s2", week: 1, home: "c", away: "d" },
        { sessionId: "s2", week: 2, home: "a", away: "c" },
      ]);
      expect(schedule.filter((f) => f.sessionId === "s1")).toEqual([
        { sessionId: "s1", week: 1, home: "a", away: "c" },
      ]);
    });

    it("clears a session when given no fixtures", () => {
      writeSchedule(["s1,1,a,b", "s2,1,c,d"]);
      const store = new CsvLeagueStore(dir);
      expect(store.replaceSchedule("s1", [])).toBe(0);
      expect(store.load().schedule.map((f) => f.sessionId)).toEqual(["s2"]);
    });

    it("writes a header-only file when nothing is scheduled at all", () => {
      const store = new CsvLeagueStore(dir);
      store.replaceSchedule("s1", []);
      expect(scheduleFile().trim()).toBe("session,week,home,away");
      expect(store.load().schedule).toEqual([]);
    });

    it("rejects a fixture belonging to another session", () => {
      const store = new CsvLeagueStore(dir);
      expect(() =>
        store.replaceSchedule("s1", [
          { sessionId: "s2", week: 1, home: "a", away: "b" },
        ]),
      ).toThrow(/passed to replaceSchedule/);
    });

    it("validates the whole batch before writing anything", () => {
      writeSchedule(["s1,1,a,b"]);
      const store = new CsvLeagueStore(dir);
      expect(() =>
        store.replaceSchedule("s1", [
          { sessionId: "s1", week: 1, home: "c", away: "d" },
          { sessionId: "s1", week: 1, home: "a", away: "ghost" },
        ]),
      ).toThrow(/Unknown player "ghost"/);
      // The original fixture must still be there — no partial write.
      expect(store.load().schedule).toEqual([
        { sessionId: "s1", week: 1, home: "a", away: "b" },
      ]);
    });
  });

  describe("rejects what a hand edit gets wrong", () => {
    it("rejects an unknown player", () => {
      writeSchedule(["s1,1,a,ghost"]);
      expect(() => load()).toThrow(/Unknown player "ghost"/);
    });

    it("rejects a player against themselves", () => {
      writeSchedule(["s1,1,a,a"]);
      expect(() => load()).toThrow(/cannot play themselves/);
    });

    it("rejects a player booked twice in one week", () => {
      writeSchedule(["s1,1,a,b", "s1,1,a,c"]);
      expect(() => load()).toThrow(/scheduled twice/);
    });

    it("allows the same pairing in different weeks (a rematch)", () => {
      writeSchedule(["s1,1,a,b", "s1,2,a,b"]);
      expect(load().schedule).toHaveLength(2);
    });

    it("allows the same player in the same week of a different session", () => {
      writeSchedule(["s1,1,a,b", "s2,1,a,c"]);
      expect(load().schedule).toHaveLength(2);
    });

    it("rejects a non-numeric week", () => {
      writeSchedule(["s1,one,a,b"]);
      expect(() => load()).toThrow(/must be a number/);
    });

    it("rejects week zero", () => {
      writeSchedule(["s1,0,a,b"]);
      expect(() => load()).toThrow(/positive integer/);
    });

    it("rejects a missing column", () => {
      writeFileSync(
        join(dir, "schedule.csv"),
        ["session,week,home", "s1,1,a"].join("\n") + "\n",
        "utf8",
      );
      expect(() => load()).toThrow(/away/);
    });
  });

  it("does not affect standings, ratings or spots", () => {
    // A schedule is a plan. Nothing derived may move because of it.
    const games =
      [
        "session,matchId,week,home,away,winner,loserBalls,forfeit",
        "s1,s1-w1-1,1,a,b,a,2,0",
      ].join("\n") + "\n";
    writeFileSync(join(dir, "games.csv"), games, "utf8");
    const before = load();
    writeSchedule(["s1,1,c,d", "s1,2,a,d", "s1,3,b,c"]);
    const after = load();
    expect(after.matches).toEqual(before.matches);
    expect(after.players).toEqual(before.players);
    expect(after.schedule).toHaveLength(3);
  });
});

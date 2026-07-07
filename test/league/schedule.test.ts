import { describe, it, expect } from "vitest";
import { buildSchedule, type WeekSchedule } from "../../src/index.js";

/** Canonical "a-b" key for a pairing, order-independent. */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

/** Every distinct pairing seen across the schedule, with its occurrence count. */
function pairCounts(schedule: WeekSchedule[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const week of schedule) {
    for (const m of week.matches) {
      const key = pairKey(m.home, m.away);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

describe("buildSchedule", () => {
  describe("validation", () => {
    it("rejects fewer than two players", () => {
      expect(() => buildSchedule(["a"], 1)).toThrow(/at least two/);
    });
    it("rejects duplicate ids", () => {
      expect(() => buildSchedule(["a", "b", "a"], 1)).toThrow(/[Dd]uplicate/);
    });
    it("rejects a negative or non-integer week count", () => {
      expect(() => buildSchedule(["a", "b"], -1)).toThrow(/non-negative/);
      expect(() => buildSchedule(["a", "b"], 1.5)).toThrow(/non-negative/);
    });
    it("returns nothing for zero weeks", () => {
      expect(buildSchedule(["a", "b"], 0)).toEqual([]);
    });
  });

  describe("even roster (no byes)", () => {
    const players = ["a", "b", "c", "d"];

    it("plays a full round-robin in players-1 weeks with no byes", () => {
      const schedule = buildSchedule(players, players.length - 1);
      expect(schedule).toHaveLength(3);
      for (const week of schedule) {
        expect(week.bye).toBeUndefined();
        expect(week.matches).toHaveLength(2); // n/2 per week
      }
    });

    it("pairs every player with every other exactly once per cycle", () => {
      const schedule = buildSchedule(players, players.length - 1);
      const counts = pairCounts(schedule);
      expect(counts.size).toBe(6); // C(4,2)
      for (const count of counts.values()) {
        expect(count).toBe(1);
      }
    });

    it("has no player playing twice in the same week", () => {
      const schedule = buildSchedule(players, players.length - 1);
      for (const week of schedule) {
        const seen = week.matches.flatMap((m) => [m.home, m.away]);
        expect(new Set(seen).size).toBe(seen.length);
      }
    });
  });

  describe("odd roster (rotating byes)", () => {
    const players = ["a", "b", "c", "d", "e"];

    it("gives exactly one player a bye each week", () => {
      const schedule = buildSchedule(players, players.length);
      for (const week of schedule) {
        expect(week.bye).toBeDefined();
        expect(week.matches).toHaveLength(2); // (n-1)/2 per week
      }
    });

    it("gives every player exactly one bye over a full cycle", () => {
      const schedule = buildSchedule(players, players.length);
      const byes = schedule.map((w) => w.bye);
      expect(new Set(byes)).toEqual(new Set(players));
    });

    it("pairs every player with every other exactly once per cycle", () => {
      const schedule = buildSchedule(players, players.length);
      const counts = pairCounts(schedule);
      expect(counts.size).toBe(10); // C(5,2)
      for (const count of counts.values()) {
        expect(count).toBe(1);
      }
    });

    it("never schedules a bye player in a match that week", () => {
      const schedule = buildSchedule(players, players.length);
      for (const week of schedule) {
        const playing = week.matches.flatMap((m) => [m.home, m.away]);
        expect(playing).not.toContain(week.bye);
      }
    });
  });

  describe("length handling", () => {
    const players = ["a", "b", "c", "d"];

    it("truncates to the opening rounds when weeks < cycle", () => {
      const schedule = buildSchedule(players, 1);
      expect(schedule).toHaveLength(1);
      expect(schedule[0]!.week).toBe(1);
    });

    it("repeats and balances home/away over a double round-robin", () => {
      const weeks = 2 * (players.length - 1);
      const schedule = buildSchedule(players, weeks);
      expect(schedule).toHaveLength(6);

      // Every pairing played exactly twice.
      const counts = pairCounts(schedule);
      for (const count of counts.values()) {
        expect(count).toBe(2);
      }

      // Each player's home and away counts are equal across the double RR.
      const home = new Map<string, number>();
      const away = new Map<string, number>();
      for (const week of schedule) {
        for (const m of week.matches) {
          home.set(m.home, (home.get(m.home) ?? 0) + 1);
          away.set(m.away, (away.get(m.away) ?? 0) + 1);
        }
      }
      for (const p of players) {
        expect(home.get(p)).toBe(away.get(p));
      }
    });
  });

  describe("rotation offset (cross-session bye fairness)", () => {
    const players = ["a", "b", "c", "d", "e"]; // odd → one bye per week

    it("shifts which players get the byes", () => {
      const base = buildSchedule(players, 3).map((w) => w.bye);
      const shifted = buildSchedule(players, 3, { rotation: 2 }).map((w) => w.bye);
      expect(shifted).not.toEqual(base);
    });

    it("still produces a valid round-robin when offset a full cycle", () => {
      const offset = buildSchedule(players, players.length, {
        rotation: players.length,
      });
      // A full cycle from any offset still gives everyone exactly one bye.
      expect(new Set(offset.map((w) => w.bye))).toEqual(new Set(players));
      const counts = pairCounts(offset);
      expect(counts.size).toBe(10);
      for (const c of counts.values()) expect(c).toBe(1);
    });

    it("rejects a negative rotation", () => {
      expect(() => buildSchedule(players, 1, { rotation: -1 })).toThrow(
        /non-negative/,
      );
    });
  });

  it("assigns sequential 1-based week numbers", () => {
    const schedule = buildSchedule(["a", "b", "c", "d"], 5);
    expect(schedule.map((w) => w.week)).toEqual([1, 2, 3, 4, 5]);
  });
});

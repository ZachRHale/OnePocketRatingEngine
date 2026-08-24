import { describe, it, expect } from "vitest";
import {
  buildSchedule,
  fixturesFor,
  fixturesToWeeks,
  type Fixture,
} from "../../src/index.js";

describe("fixturesFor", () => {
  it("flattens a generated schedule into persistable rows", () => {
    const fixtures = fixturesFor("s1", buildSchedule(["a", "b", "c", "d"], 2));
    expect(fixtures).toHaveLength(4);
    expect(fixtures.every((f) => f.sessionId === "s1")).toBe(true);
    expect(fixtures.map((f) => f.week)).toEqual([1, 1, 2, 2]);
  });

  it("drops byes, which are derived on the way back in", () => {
    // 3 players, 3 weeks: one fixture per week, one bye per week.
    const weeks = buildSchedule(["a", "b", "c"], 3);
    expect(weeks.every((w) => w.bye !== undefined)).toBe(true);
    const fixtures = fixturesFor("s1", weeks);
    expect(fixtures).toHaveLength(3);
    // The bye is recoverable from the roster, so nothing was lost.
    const back = fixturesToWeeks(fixtures, ["a", "b", "c"]);
    expect(back.map((w) => w.byes)).toEqual(
      weeks.map((w) => [w.bye as string]),
    );
  });

  it("round-trips a full nine-week, nine-player division", () => {
    const roster = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const weeks = fixturesToWeeks(
      fixturesFor("s1", buildSchedule(roster, 9)),
      roster,
    );
    expect(weeks).toHaveLength(9);
    // Every week: four fixtures and exactly one bye.
    expect(weeks.map((w) => w.matches.length)).toEqual(Array(9).fill(4));
    expect(weeks.map((w) => w.byes.length)).toEqual(Array(9).fill(1));
    // Every player sits out exactly once across the cycle.
    const byes = weeks.flatMap((w) => w.byes);
    expect([...byes].sort()).toEqual([...roster].sort());
  });
});

describe("fixturesToWeeks", () => {
  const f = (week: number, home: string, away: string): Fixture => ({
    sessionId: "s1",
    week,
    home,
    away,
  });

  it("orders weeks ascending regardless of file order", () => {
    const weeks = fixturesToWeeks([f(3, "a", "b"), f(1, "c", "d"), f(2, "a", "c")]);
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3]);
  });

  it("keeps fixture order within a week", () => {
    const weeks = fixturesToWeeks([f(1, "c", "d"), f(1, "a", "b")]);
    expect(weeks[0]!.matches).toEqual([
      { home: "c", away: "d" },
      { home: "a", away: "b" },
    ]);
  });

  it("omits weeks with no fixtures", () => {
    // Week 2 deleted by hand: weeks 1 and 3 remain, and 2 simply is not there.
    const weeks = fixturesToWeeks([f(1, "a", "b"), f(3, "a", "b")]);
    expect(weeks.map((w) => w.week)).toEqual([1, 3]);
  });

  it("derives no byes when no roster is given", () => {
    const weeks = fixturesToWeeks([f(1, "a", "b")]);
    expect(weeks[0]!.byes).toEqual([]);
  });

  it("reports every rostered player left out of a week", () => {
    // The hand-edited case buildSchedule cannot produce: several sitting out.
    const weeks = fixturesToWeeks([f(1, "a", "b")], ["a", "b", "c", "d", "e"]);
    expect(weeks[0]!.byes).toEqual(["c", "d", "e"]);
  });

  it("returns byes in roster order, not alphabetical", () => {
    const weeks = fixturesToWeeks([f(1, "a", "b")], ["a", "b", "e", "c", "d"]);
    expect(weeks[0]!.byes).toEqual(["e", "c", "d"]);
  });

  it("ignores fixture players who are not on the passed roster", () => {
    // Scoping a division's roster must not invent a bye for an outsider.
    const weeks = fixturesToWeeks([f(1, "a", "z")], ["a", "b"]);
    expect(weeks[0]!.byes).toEqual(["b"]);
  });

  it("handles an empty fixture list", () => {
    expect(fixturesToWeeks([], ["a", "b"])).toEqual([]);
  });
});

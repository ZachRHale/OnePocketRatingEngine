import { describe, it, expect } from "vitest";
import { draftDivisions, type DraftEntry } from "../../src/index.js";

/** The 17-player roster the league actually opened with, by Fargo seed. */
const ROSTER: DraftEntry[] = [
  { playerId: "dave", rating: 639 },
  { playerId: "jay", rating: 622 },
  { playerId: "wiley", rating: 553 },
  { playerId: "brendan", rating: 552 },
  { playerId: "jason", rating: 546 },
  { playerId: "josh", rating: 540 },
  { playerId: "thomas", rating: 533 },
  { playerId: "jesse", rating: 530 },
  { playerId: "ryan", rating: 508 },
  { playerId: "lucas", rating: 507 },
  { playerId: "will", rating: 450 },
  { playerId: "zach", rating: 450 },
  { playerId: "chad", rating: 450 },
  { playerId: "jeff", rating: 450 },
  { playerId: "paul", rating: 429 },
  { playerId: "chrisco", rating: 370 },
  { playerId: "sharlee", rating: 362 },
];

function entries(...ratings: number[]): DraftEntry[] {
  return ratings.map((rating, i) => ({ playerId: `p${i}`, rating }));
}

function averages(
  divisions: { playerIds: string[] }[],
  pool: DraftEntry[],
): number[] {
  const byId = new Map(pool.map((e) => [e.playerId, e.rating]));
  return divisions.map(
    (d) =>
      d.playerIds.reduce((sum, id) => sum + byId.get(id)!, 0) /
      d.playerIds.length,
  );
}

describe("draftDivisions", () => {
  describe("sizes", () => {
    it("splits an odd roster as evenly as possible, larger first", () => {
      const divisions = draftDivisions(ROSTER, 2);
      expect(divisions.map((d) => d.playerIds.length)).toEqual([9, 8]);
    });

    it("splits evenly when the roster divides evenly", () => {
      const divisions = draftDivisions(entries(600, 550, 500, 450), 2);
      expect(divisions.map((d) => d.playerIds.length)).toEqual([2, 2]);
    });

    it("handles more than two divisions", () => {
      const divisions = draftDivisions(ROSTER, 3);
      expect(divisions.map((d) => d.playerIds.length)).toEqual([6, 6, 5]);
      expect(divisions.map((d) => d.id)).toEqual(["a", "b", "c"]);
    });

    it("places every player exactly once", () => {
      const divisions = draftDivisions(ROSTER, 2);
      const placed = divisions.flatMap((d) => d.playerIds);
      expect(placed).toHaveLength(ROSTER.length);
      expect(new Set(placed).size).toBe(ROSTER.length);
    });

    it("treats one division as a no-op split", () => {
      const divisions = draftDivisions(ROSTER, 1);
      expect(divisions).toHaveLength(1);
      expect(divisions[0]!.playerIds).toHaveLength(17);
    });
  });

  describe("balance", () => {
    it("keeps the division averages within a point on the real roster", () => {
      const divisions = draftDivisions(ROSTER, 2);
      const [a, b] = averages(divisions, ROSTER);
      expect(Math.abs(a! - b!)).toBeLessThan(1);
    });

    it("beats a plain serpentine, which tilts on an odd roster", () => {
      // A plain snake hands the extra pick AND the weakest player to the same
      // division; the refinement pass is what closes that gap.
      const snakeA = [
        "dave",
        "brendan",
        "jason",
        "jesse",
        "ryan",
        "zach",
        "chad",
        "chrisco",
        "sharlee",
      ];
      const byId = new Map(ROSTER.map((e) => [e.playerId, e.rating]));
      const snakeAvgA =
        snakeA.reduce((sum, id) => sum + byId.get(id)!, 0) / snakeA.length;
      const snakeAvgB =
        (ROSTER.reduce((sum, e) => sum + e.rating, 0) -
          snakeA.reduce((sum, id) => sum + byId.get(id)!, 0)) /
        (ROSTER.length - snakeA.length);
      const snakeGap = Math.abs(snakeAvgA - snakeAvgB);

      const [a, b] = averages(draftDivisions(ROSTER, 2), ROSTER);
      expect(Math.abs(a! - b!)).toBeLessThan(snakeGap);
    });

    it("balances three divisions too", () => {
      const avgs = averages(draftDivisions(ROSTER, 3), ROSTER);
      expect(Math.max(...avgs) - Math.min(...avgs)).toBeLessThan(15);
    });
  });

  describe("determinism", () => {
    it("does not depend on input order", () => {
      const shuffled = [...ROSTER].reverse();
      expect(draftDivisions(shuffled, 2)).toEqual(draftDivisions(ROSTER, 2));
    });

    it("breaks rating ties by player id", () => {
      // zach and chad are both 450; the tie must resolve the same way every run.
      const once = draftDivisions(ROSTER, 2);
      const twice = draftDivisions(ROSTER, 2);
      expect(once).toEqual(twice);
    });

    it("lists each division strongest first", () => {
      const byId = new Map(ROSTER.map((e) => [e.playerId, e.rating]));
      for (const d of draftDivisions(ROSTER, 2)) {
        const ratings = d.playerIds.map((id) => byId.get(id)!);
        expect(ratings).toEqual([...ratings].sort((x, y) => y - x));
      }
    });
  });

  describe("labels and ids", () => {
    it("titles divisions from their id by default", () => {
      expect(draftDivisions(ROSTER, 2).map((d) => d.label)).toEqual([
        "Division A",
        "Division B",
      ]);
    });

    it("accepts explicit labels, falling back per index", () => {
      const divisions = draftDivisions(ROSTER, 2, { labels: ["Sharks"] });
      expect(divisions.map((d) => d.label)).toEqual(["Sharks", "Division B"]);
    });
  });

  describe("rejects impossible drafts", () => {
    it("needs at least one division", () => {
      expect(() => draftDivisions(ROSTER, 0)).toThrow(/positive integer/);
    });

    it("rejects a fractional division count", () => {
      expect(() => draftDivisions(ROSTER, 2.5)).toThrow(/positive integer/);
    });

    it("rejects more divisions than players", () => {
      expect(() => draftDivisions(entries(500, 450), 3)).toThrow(/Cannot draft/);
    });

    it("rejects a duplicated player", () => {
      const dupe = [
        { playerId: "a", rating: 500 },
        { playerId: "a", rating: 450 },
      ];
      expect(() => draftDivisions(dupe, 2)).toThrow(/Duplicate player ids/);
    });
  });
});

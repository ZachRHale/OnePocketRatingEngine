import { describe, it, expect } from "vitest";
import {
  DEFAULT_HANDICAP_TABLE,
  ballSpotForRatings,
  normalizeHandicapTable,
  tierForGap,
  type HandicapTier,
} from "../../src/index.js";

const table = normalizeHandicapTable(DEFAULT_HANDICAP_TABLE);

describe("handicap table", () => {
  describe("normalizeHandicapTable", () => {
    it("rejects an empty table", () => {
      expect(() => normalizeHandicapTable([])).toThrow(/at least one tier/);
    });
    it("rejects a table with no minGap:0 tier", () => {
      const bad: HandicapTier[] = [{ minGap: 10, stronger: 8, weaker: 7 }];
      expect(() => normalizeHandicapTable(bad)).toThrow(/minGap: 0/);
    });
    it("sorts tiers by minGap ascending", () => {
      const unsorted: HandicapTier[] = [
        { minGap: 100, stronger: 8, weaker: 6 },
        { minGap: 0, stronger: 8, weaker: 8 },
      ];
      expect(normalizeHandicapTable(unsorted).map((t) => t.minGap)).toEqual([
        0, 100,
      ]);
    });
  });

  describe("tierForGap", () => {
    it("picks the widest tier not exceeding the gap", () => {
      expect(tierForGap(table, 0)).toMatchObject({ stronger: 8, weaker: 8 });
      expect(tierForGap(table, 30)).toMatchObject({ stronger: 8, weaker: 7 });
      expect(tierForGap(table, 300)).toMatchObject({ stronger: 9, weaker: 5 });
      expect(tierForGap(table, 10000)).toMatchObject({ stronger: 10, weaker: 5 });
    });
  });

  describe("ballSpotForRatings", () => {
    it("gives equal players an even spot", () => {
      expect(ballSpotForRatings(table, 500, 500)).toEqual({ home: 8, away: 8 });
    });
    it("gives the stronger side the higher target (home stronger)", () => {
      expect(ballSpotForRatings(table, 800, 500)).toEqual({ home: 9, away: 5 });
    });
    it("orients the spot correctly when away is stronger", () => {
      expect(ballSpotForRatings(table, 500, 800)).toEqual({ home: 5, away: 9 });
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  SimpleProvisionalRatingEngine,
  frozenRatingsForSession,
  matchesInSession,
  ratingsAfterSession,
  type Session,
} from "../../src/index.js";
import { match, player, wins } from "../factories.js";

const engine = new SimpleProvisionalRatingEngine();

const players = [player("a", 500), player("b", 500)];

const sessions: Session[] = [
  { id: "s1", label: "S1", index: 1, weeks: 1, playerIds: ["a", "b"] },
  { id: "s2", label: "S2", index: 2, weeks: 1, playerIds: ["a", "b"] },
];

// s1: "a" sweeps "b". s2: "b" sweeps "a".
const matches = [
  match({ id: "m1", sessionId: "s1", home: "a", away: "b", games: wins("a", 3) }),
  match({ id: "m2", sessionId: "s2", home: "a", away: "b", games: wins("b", 3) }),
];

const ratingOf = (rs: { playerId: string; leagueRating: number }[], id: string) =>
  rs.find((r) => r.playerId === id)!.leagueRating;

describe("session queries", () => {
  it("matchesInSession returns only that session's matches", () => {
    expect(matchesInSession(matches, "s1").map((m) => m.id)).toEqual(["m1"]);
    expect(matchesInSession(matches, "s2").map((m) => m.id)).toEqual(["m2"]);
  });

  describe("frozenRatingsForSession", () => {
    it("uses Fargo seeds for the first session (no prior play)", () => {
      const frozen = frozenRatingsForSession(engine, players, matches, sessions, "s1");
      expect(ratingOf(frozen, "a")).toBe(500);
      expect(ratingOf(frozen, "b")).toBe(500);
      expect(frozen.every((r) => r.gamesPlayed === 0)).toBe(true);
    });

    it("reflects earlier sessions but not the session itself", () => {
      const frozen = frozenRatingsForSession(engine, players, matches, sessions, "s2");
      // "a" swept s1, so a's frozen rating for s2 is up and b's is down.
      expect(ratingOf(frozen, "a")).toBeGreaterThan(500);
      expect(ratingOf(frozen, "b")).toBeLessThan(500);
      // s2's own result (b sweeping a) is NOT folded into the freeze.
      expect(frozen.every((r) => r.gamesPlayed === 3)).toBe(true);
    });
  });

  it("frozen(next) equals ratingsAfter(current) — the boundary is shared", () => {
    const afterS1 = ratingsAfterSession(engine, players, matches, sessions, "s1");
    const frozenS2 = frozenRatingsForSession(engine, players, matches, sessions, "s2");
    expect(afterS1).toEqual(frozenS2);
  });

  it("throws on an unknown session", () => {
    expect(() =>
      frozenRatingsForSession(engine, players, matches, sessions, "nope"),
    ).toThrow(/Unknown session/);
  });
});

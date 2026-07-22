import { describe, it, expect } from "vitest";
import { matchesInSession } from "../../src/index.js";
import { match, wins } from "../factories.js";

// s1: "a" sweeps "b". s2: "b" sweeps "a".
const matches = [
  match({ id: "m1", sessionId: "s1", home: "a", away: "b", games: wins("a", 3) }),
  match({ id: "m2", sessionId: "s2", home: "a", away: "b", games: wins("b", 3) }),
];

describe("session queries", () => {
  it("matchesInSession returns only that session's matches, in order", () => {
    expect(matchesInSession(matches, "s1").map((m) => m.id)).toEqual(["m1"]);
    expect(matchesInSession(matches, "s2").map((m) => m.id)).toEqual(["m2"]);
  });

  it("returns an empty list for a session with no matches", () => {
    expect(matchesInSession(matches, "nope")).toEqual([]);
  });
});

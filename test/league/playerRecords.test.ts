import { describe, it, expect } from "vitest";
import { computePlayerRecords } from "../../src/index.js";
import { match, win, wins } from "../factories.js";

describe("computePlayerRecords", () => {
  it("tallies games won/lost and total balls made", () => {
    // a wins 3-1 over b on an even 8-8 spot.
    const records = computePlayerRecords([
      match({
        id: "m",
        home: "a",
        away: "b",
        games: [...wins("a", 3), ...wins("b", 1)],
      }),
    ]);
    const a = records.get("a")!;
    const b = records.get("b")!;

    expect(a).toMatchObject({ gamesPlayed: 4, gamesWon: 3, gamesLost: 1 });
    expect(b).toMatchObject({ gamesPlayed: 4, gamesWon: 1, gamesLost: 3 });
    expect(a.winPct).toBeCloseTo(0.75, 10);
    // a won 3 games (8 balls each) and lost 1 (0 balls, default shutout) => 24.
    expect(a.ballsMade).toBe(24);
  });

  it("measures loss closeness as balls made vs target in losses", () => {
    // a loses one game having made 6 of 8; closeness = 0.75.
    const records = computePlayerRecords([
      match({ id: "m", home: "a", away: "b", games: [win("b", 6)] }),
    ]);
    expect(records.get("a")!.lossCloseness).toBeCloseTo(6 / 8, 10);
  });

  it("treats an undefeated player as maximally close, unplayed as zero", () => {
    const records = computePlayerRecords(
      [match({ id: "m", home: "a", away: "b", games: wins("a", 2) })],
      ["a", "b", "c"], // c seeded but never plays
    );
    expect(records.get("a")!.lossCloseness).toBe(1); // never lost
    expect(records.get("c")!).toMatchObject({
      gamesPlayed: 0,
      winPct: 0,
      lossCloseness: 0,
    });
  });

  it("throws when a game winner is not a match participant", () => {
    const bad = match({ id: "m", home: "a", away: "b", games: wins("a", 1) });
    bad.games[0]!.winner = "ghost";
    expect(() => computePlayerRecords([bad])).toThrow(/neither participant/);
  });
});

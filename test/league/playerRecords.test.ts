import { describe, it, expect } from "vitest";
import { computePlayerRecords } from "../../src/index.js";
import { forfeitMatch, match, win, wins } from "../factories.js";

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

  it("credits a forfeit as a full race won/lost with no balls", () => {
    const records = computePlayerRecords([
      forfeitMatch({ id: "f", home: "a", away: "b", winner: "a" }),
    ]);
    const a = records.get("a")!;
    const b = records.get("b")!;
    // Full race (3) awarded to the winner; the loser takes 3 losses.
    expect(a).toMatchObject({ gamesPlayed: 3, gamesWon: 3, gamesLost: 0 });
    expect(b).toMatchObject({ gamesPlayed: 3, gamesWon: 0, gamesLost: 3 });
    expect(a.winPct).toBe(1);
    expect(b.winPct).toBe(0);
    // No games were played, so no balls are credited to either side.
    expect(a.ballsMade).toBe(0);
    expect(b.ballsMade).toBe(0);
  });

  it("excludes forfeit losses from loss closeness", () => {
    // b loses a real game 6/8 (closeness 0.75) and also forfeits once. The
    // forfeit loss carries no ball data, so it must not drag the average down.
    const records = computePlayerRecords([
      match({ id: "m", home: "a", away: "b", games: [win("a", 6)] }),
      forfeitMatch({ id: "f", home: "a", away: "b", winner: "a" }),
    ]);
    const b = records.get("b")!;
    expect(b.gamesLost).toBe(4); // 1 real + 3 forfeit
    expect(b.lossCloseness).toBeCloseTo(6 / 8, 10); // measured on the real loss only
  });

  it("treats a player whose only losses are forfeits as maximally close", () => {
    const records = computePlayerRecords([
      match({ id: "m", home: "a", away: "b", games: wins("a", 2) }), // a undefeated in real play
      forfeitMatch({ id: "f", home: "b", away: "a", winner: "b" }), // a forfeits
    ]);
    const a = records.get("a")!;
    expect(a.gamesLost).toBe(3); // all from the forfeit
    expect(a.lossCloseness).toBe(1); // no real-game losses to measure
  });

  it("throws when a game winner is not a match participant", () => {
    const bad = match({ id: "m", home: "a", away: "b", games: wins("a", 1) });
    bad.games[0]!.winner = "ghost";
    expect(() => computePlayerRecords([bad])).toThrow(/neither participant/);
  });
});

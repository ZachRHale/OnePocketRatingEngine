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
    // a won 3 games (8 balls each) and lost 1 (0 balls, default shutout) => 24
    // made out of 4 * 8 = 32 available.
    expect(a.ballsMade).toBe(24);
    expect(a.ballsAvailable).toBe(32);
    expect(a.ballPct).toBeCloseTo(24 / 32, 10);
    // b won 1 (8 balls) and lost 3 (0 each) => 8 of 32.
    expect(b.ballPct).toBeCloseTo(8 / 32, 10);
  });

  it("measures ball% as balls made over balls available across all games", () => {
    // a plays two games on an even 8-8 spot: wins one (a full 8/8) and loses one
    // having made 6 of 8. Ball% pools both: (8 + 6) / (8 + 8) = 14/16.
    const records = computePlayerRecords([
      match({ id: "m", home: "a", away: "b", games: [win("a"), win("b", 6)] }),
    ]);
    const a = records.get("a")!;
    expect(a.ballsMade).toBe(14);
    expect(a.ballsAvailable).toBe(16);
    expect(a.ballPct).toBeCloseTo(14 / 16, 10);
  });

  it("gives a perfect ball% to an unbeaten player, zero to the unplayed", () => {
    const records = computePlayerRecords(
      [match({ id: "m", home: "a", away: "b", games: wins("a", 2) })],
      ["a", "b", "c"], // c seeded but never plays
    );
    // a made all 16 of the 16 balls available across its two wins.
    expect(records.get("a")!.ballPct).toBe(1);
    expect(records.get("c")!).toMatchObject({
      gamesPlayed: 0,
      winPct: 0,
      ballsAvailable: 0,
      ballPct: 0,
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
    // No games were played, so no balls are made OR available for either side.
    expect(a.ballsMade).toBe(0);
    expect(a.ballsAvailable).toBe(0);
    expect(b.ballsMade).toBe(0);
    expect(b.ballsAvailable).toBe(0);
  });

  it("excludes forfeit games from ball% (no made, no available)", () => {
    // b loses a real game 6/8 (ball% 0.75) and also forfeits once. The forfeit
    // adds nothing to balls made or available, so it must not move ball%.
    const records = computePlayerRecords([
      match({ id: "m", home: "a", away: "b", games: [win("a", 6)] }),
      forfeitMatch({ id: "f", home: "a", away: "b", winner: "a" }),
    ]);
    const b = records.get("b")!;
    expect(b.gamesLost).toBe(4); // 1 real + 3 forfeit
    expect(b.ballsAvailable).toBe(8); // only the real game
    expect(b.ballPct).toBeCloseTo(6 / 8, 10); // measured on the real loss only
  });

  it("throws when a game winner is not a match participant", () => {
    const bad = match({ id: "m", home: "a", away: "b", games: wins("a", 1) });
    bad.games[0]!.winner = "ghost";
    expect(() => computePlayerRecords([bad])).toThrow(/neither participant/);
  });
});

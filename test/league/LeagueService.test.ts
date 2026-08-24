import { describe, it, expect } from "vitest";
import { LeagueService, type Match, type PlayerRating } from "../../src/index.js";
import { match, player, win, wins } from "../factories.js";

function rating(
  playerId: string,
  leagueRating: number,
  overrides: Partial<PlayerRating> = {},
): PlayerRating {
  return {
    playerId,
    leagueRating,
    confidence: 0.5,
    provisional: false,
    trend: 0,
    gamesPlayed: 30,
    ...overrides,
  };
}

describe("LeagueService", () => {
  const players = [
    player("a", 500, "Alice"),
    player("b", 500, "Bob"),
    player("c", 500, "Carol"),
  ];
  const ratings = [
    rating("a", 800),
    rating("b", 500, { provisional: true, gamesPlayed: 5 }),
    rating("c", 650),
  ];
  // a: 6W-1L (.857) | c: 4W-5L (.444) | b: 2W-6L (.25)
  const matches: Match[] = [
    match({ id: "m1", home: "a", away: "b", games: wins("a", 3) }),
    match({
      id: "m2",
      home: "a",
      away: "c",
      games: [...wins("a", 3), ...wins("c", 1)],
    }),
    match({
      id: "m3",
      home: "c",
      away: "b",
      games: [...wins("c", 3), ...wins("b", 2)],
    }),
  ];
  const service = () => new LeagueService(players, ratings, matches);

  describe("rating lookups", () => {
    it("returns the League Rating", () => {
      expect(service().leagueRatingOf("a")).toBe(800);
    });
    it("reports provisional status", () => {
      expect(service().isProvisional("b")).toBe(true);
      expect(service().isProvisional("a")).toBe(false);
    });
    it("throws for an unknown player", () => {
      expect(() => service().leagueRatingOf("ghost")).toThrow(/No rating/);
    });
  });

  describe("recordOf", () => {
    it("returns the aggregated win/loss record", () => {
      const a = service().recordOf("a");
      expect(a).toMatchObject({ gamesWon: 6, gamesLost: 1, gamesPlayed: 7 });
      expect(a.winPct).toBeCloseTo(6 / 7, 10);
    });
    it("throws for an unknown player", () => {
      expect(() => service().recordOf("ghost")).toThrow(/No record/);
    });
  });

  describe("ballSpotFor", () => {
    it("resolves tonight's spot oriented to home/away", () => {
      // a=800 vs c=650 => gap 150 => 8-6 tier; a stronger (home).
      expect(service().ballSpotFor("a", "c")).toEqual({ home: 8, away: 6 });
      expect(service().ballSpotFor("c", "a")).toEqual({ home: 6, away: 8 });
    });
    it("throws on a self-matchup", () => {
      expect(() => service().ballSpotFor("a", "a")).toThrow(
        /cannot play themselves/,
      );
    });
  });

  describe("standings", () => {
    it("ranks by win percentage descending with 1-based rank", () => {
      const table = service().standings();
      expect(table.map((s) => s.playerId)).toEqual(["a", "c", "b"]);
      expect(table.map((s) => s.rank)).toEqual([1, 2, 3]);
      expect(table[0]).toMatchObject({ name: "Alice", gamesWon: 6, gamesLost: 1 });
    });

    it("ranks on results, NOT on rating", () => {
      // q is rated far higher, but p has the better record and must rank first.
      const ps = [player("p", 500, "Pam"), player("q", 500, "Quinn")];
      const rs = [rating("p", 400), rating("q", 900)];
      const ms: Match[] = [
        match({ id: "m", home: "p", away: "q", games: [...wins("p", 3), ...wins("q", 1)] }),
      ];
      const table = new LeagueService(ps, rs, ms).standings();
      expect(table.map((s) => s.playerId)).toEqual(["p", "q"]);
    });

    it("breaks a win% tie by ball% (a narrow loss beats a blowout)", () => {
      // x and y each go 1-1; x's loss was hill-hill (made 7), y's was a blowout
      // (made 1). Wins are a full 8/8 for both, so x's higher ball% wins the tie.
      const ps = [
        player("x", 500, "Xavier"),
        player("y", 500, "Yolanda"),
        player("fx", 500, "FillerX"),
        player("fy", 500, "FillerY"),
      ];
      const rs = [rating("x", 500), rating("y", 500)];
      const ms: Match[] = [
        match({ id: "mx", home: "x", away: "fx", games: [win("x"), win("fx", 7)] }),
        match({ id: "my", home: "y", away: "fy", games: [win("y"), win("fy", 1)] }),
      ];
      const ids = new LeagueService(ps, rs, ms).standings().map((s) => s.playerId);
      expect(ids.indexOf("x")).toBeLessThan(ids.indexOf("y"));
    });

    it("includes a player who never played, with a zero win%, below winners", () => {
      // 'a' beats a filler; 'z' is on the roster but never plays a game.
      const ps = [
        player("a", 500, "Alice"),
        player("z", 500, "Zoe"),
        player("f", 500, "Filler"),
      ];
      const rs = [rating("a", 500), rating("z", 500)];
      const ms: Match[] = [
        match({ id: "m", home: "a", away: "f", games: wins("a", 2) }),
      ];
      const table = new LeagueService(ps, rs, ms).standings();
      const ids = table.map((s) => s.playerId);
      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("z"));
      const z = table.find((s) => s.playerId === "z")!;
      expect(z).toMatchObject({ gamesPlayed: 0, gamesWon: 0, winPct: 0 });
    });
  });

  describe("standings scoped to a division", () => {
    // Two two-player divisions. `a` and `b` are one division; `c` and `d` the
    // other. The crossover match is what distinguishes a division race from a
    // plain session filter.
    const ps = [
      player("a", 500, "Alice"),
      player("b", 500, "Bob"),
      player("c", 500, "Carol"),
      player("d", 500, "Dave"),
    ];
    const rs = [rating("a", 500), rating("b", 500), rating("c", 500), rating("d", 500)];
    const divA = ["a", "b"];
    const ms: Match[] = [
      // Intra-division: counts for both divisions' own tables.
      match({ id: "m1", home: "a", away: "b", games: wins("a", 3) }),
      match({ id: "m2", home: "c", away: "d", games: wins("c", 3) }),
      // Crossover: must not touch either division race.
      match({ id: "m3", home: "a", away: "c", games: wins("c", 3) }),
    ];
    const svc = () => new LeagueService(ps, rs, ms);

    it("lists only the players in scope", () => {
      const table = svc().standings("s1", { playerIds: divA });
      expect(table.map((r) => r.playerId).sort()).toEqual(["a", "b"]);
    });

    it("ignores games against players outside the scope", () => {
      // 'a' is 3-0 inside the division and 0-3 in the crossover. The division
      // table must show the 3-0 only.
      const a = svc()
        .standings("s1", { playerIds: divA })
        .find((r) => r.playerId === "a")!;
      expect(a).toMatchObject({ gamesPlayed: 3, gamesWon: 3, gamesLost: 0 });
      expect(a.winPct).toBe(1);
    });

    it("counts the crossover in the unscoped table", () => {
      const a = svc()
        .standings("s1")
        .find((r) => r.playerId === "a")!;
      expect(a).toMatchObject({ gamesPlayed: 6, gamesWon: 3, gamesLost: 3 });
    });

    it("ranks from 1 within the division", () => {
      const table = svc().standings("s1", { playerIds: divA });
      expect(table.map((r) => r.rank)).toEqual([1, 2]);
      expect(table[0]!.playerId).toBe("a");
    });

    it("lists a drafted player who has not played yet, at zero", () => {
      const table = svc().standings("s1", { playerIds: ["a", "b", "d"] });
      const d = table.find((r) => r.playerId === "d")!;
      // 'd' only played 'c', who is out of scope, so the row is empty.
      expect(d).toMatchObject({ gamesPlayed: 0, winPct: 0 });
    });

    it("tolerates a duplicated id in the scope", () => {
      const table = svc().standings("s1", { playerIds: ["a", "a", "b"] });
      expect(table.map((r) => r.playerId).sort()).toEqual(["a", "b"]);
    });

    it("scopes by session and division together", () => {
      const other: Match[] = [
        ...ms,
        match({
          id: "m4",
          sessionId: "s2",
          home: "a",
          away: "b",
          games: wins("b", 3),
        }),
      ];
      const s1 = new LeagueService(ps, rs, other)
        .standings("s1", { playerIds: divA })
        .find((r) => r.playerId === "b")!;
      expect(s1.gamesWon).toBe(0);
      const s2 = new LeagueService(ps, rs, other)
        .standings("s2", { playerIds: divA })
        .find((r) => r.playerId === "b")!;
      expect(s2.gamesWon).toBe(3);
    });

    it("is unchanged from the default when the scope is the whole roster", () => {
      const all = ps.map((p) => p.id);
      expect(svc().standings("s1", { playerIds: all })).toEqual(
        svc().standings("s1"),
      );
    });
  });
});

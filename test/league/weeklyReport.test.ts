import { describe, it, expect } from "vitest";
import {
  LeagueService,
  SimpleProvisionalRatingEngine,
  buildWeeklyReport,
  currentWeekFor,
  type Division,
  type Fixture,
  type Match,
  type Player,
} from "../../src/index.js";
import { forfeitMatch, match, player, win } from "../factories.js";

const SESSION = "s1";

const PLAYERS: Player[] = [
  player("ann", 520, "Ann"),
  player("bob", 470, "Bob"),
  player("cid", 480, "Cid"),
  player("dee", 460, "Dee"),
];

const DIVISIONS: Division[] = [
  { id: "a", label: "Division A", playerIds: ["ann", "bob"] },
  { id: "b", label: "Division B", playerIds: ["cid", "dee"] },
];

function fixture(week: number, home: string, away: string): Fixture {
  return { sessionId: SESSION, week, home, away };
}

/** Weeks 1-3 of a two-division league; the same pairing every week. */
const SCHEDULE: Fixture[] = [
  fixture(1, "ann", "bob"),
  fixture(1, "cid", "dee"),
  fixture(2, "bob", "ann"),
  fixture(2, "dee", "cid"),
  fixture(3, "ann", "bob"),
  fixture(3, "cid", "dee"),
];

function played(
  id: string,
  week: number,
  home: string,
  away: string,
  winner: string,
): Match {
  const loser = winner === home ? away : home;
  return match({
    id,
    home,
    away,
    week,
    sessionId: SESSION,
    games: [win(winner, 2), win(loser, 1), win(winner, 0), win(winner, 3)],
  });
}

function report(
  matches: readonly Match[],
  options: { week?: number; schedule?: readonly Fixture[] } = {},
) {
  const engine = new SimpleProvisionalRatingEngine();
  const ratings = engine.calculateRatings({ players: PLAYERS, matches });
  const league = new LeagueService(PLAYERS, ratings, matches);
  return buildWeeklyReport(
    league,
    {
      players: PLAYERS,
      matches,
      schedule: options.schedule ?? SCHEDULE,
      divisions: DIVISIONS,
    },
    { sessionId: SESSION, sessionLabel: "Season One", week: options.week },
  );
}

describe("currentWeekFor", () => {
  it("is week 1 before anything is played", () => {
    expect(currentWeekFor([], SCHEDULE, SESSION)).toBe(1);
  });

  it("stays on the latest week while it is still being played", () => {
    const matches = [played("m1", 1, "ann", "bob", "ann")];
    expect(currentWeekFor(matches, SCHEDULE, SESSION)).toBe(1);
  });

  it("advances once every fixture of the latest week has a result", () => {
    const matches = [
      played("m1", 1, "ann", "bob", "ann"),
      played("m2", 1, "cid", "dee", "dee"),
    ];
    expect(currentWeekFor(matches, SCHEDULE, SESSION)).toBe(2);
  });

  it("is not held back by an unplayed makeup from an earlier week", () => {
    // Week 1 is one short, but a week-2 result proves the league has moved on.
    const matches = [
      played("m1", 1, "ann", "bob", "ann"),
      played("m2", 2, "bob", "ann", "bob"),
    ];
    expect(currentWeekFor(matches, SCHEDULE, SESSION)).toBe(2);
  });

  it("ignores other sessions entirely", () => {
    const other = match({
      id: "x",
      home: "ann",
      away: "bob",
      week: 5,
      sessionId: "other",
      games: [win("ann", 0), win("ann", 0), win("ann", 0)],
    });
    expect(currentWeekFor([other], SCHEDULE, SESSION)).toBe(1);
  });
});

describe("buildWeeklyReport", () => {
  const week2 = [
    played("m1", 1, "ann", "bob", "ann"),
    played("m2", 1, "cid", "dee", "dee"),
  ];

  it("reports the previous week's results, split by division", () => {
    const r = report(week2, { week: 2 });
    expect(r.week).toBe(2);
    expect(r.lastWeek).toBe(1);
    expect(r.divisions.map((d) => d.id)).toEqual(["a", "b"]);

    const a = r.divisions[0]!;
    expect(a.results).toHaveLength(1);
    expect(a.results[0]!.winner.name).toBe("Ann");
    expect(a.results[0]!.loser.name).toBe("Bob");
    expect(a.results[0]!.score).toEqual({ home: 3, away: 1 });
    expect(a.results[0]!.games).toHaveLength(4);
    expect(a.results[0]!.formattedSpot).toMatch(/^\d+-\d+$/);

    expect(r.divisions[1]!.results[0]!.winner.name).toBe("Dee");
  });

  it("has no results and no last week in week 1", () => {
    const r = report([], { week: 1 });
    expect(r.lastWeek).toBeNull();
    expect(r.divisions.every((d) => d.results.length === 0)).toBe(true);
  });

  it("previews this week's fixtures with a ball spot when spot ratings are given", () => {
    const engine = new SimpleProvisionalRatingEngine();
    const ratings = engine.calculateRatings({ players: PLAYERS, matches: [] });
    const league = new LeagueService(PLAYERS, ratings, []);
    const r = buildWeeklyReport(
      league,
      {
        players: PLAYERS,
        matches: [],
        schedule: SCHEDULE,
        divisions: DIVISIONS,
      },
      { sessionId: SESSION, week: 1, spotRatings: ratings },
    );
    const upcoming = r.divisions[0]!.upcoming;
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]!.home.name).toBe("Ann");
    expect(upcoming[0]!.formattedSpot).toBe("8-7"); // 520 vs 470: a 50-point gap
  });

  it("leaves the spot null when no spot ratings are supplied", () => {
    const r = report([], { week: 1 });
    expect(r.divisions[0]!.upcoming[0]!.spot).toBeNull();
    expect(r.divisions[0]!.upcoming[0]!.formattedSpot).toBeNull();
  });

  it("marks a fixture already played this week", () => {
    const r = report([played("m1", 2, "bob", "ann", "ann")], { week: 2 });
    expect(r.divisions[0]!.upcoming[0]!.played).toBe(true);
    expect(r.divisions[1]!.upcoming[0]!.played).toBe(false);
  });

  it("links a result to its fixture even when the seats were swapped", () => {
    // Scheduled ann (home) vs bob; played with bob in the home seat.
    const r = report([played("m1", 1, "bob", "ann", "bob")], { week: 1 });
    expect(r.divisions[0]!.upcoming[0]!.played).toBe(true);
  });

  it("lists unplayed fixtures from earlier weeks as makeups", () => {
    const r = report([played("m2", 1, "cid", "dee", "dee")], { week: 3 });
    expect(r.makeupCount).toBe(3);
    const a = r.divisions[0]!;
    expect(a.makeups.map((m) => m.week)).toEqual([1, 2]);
    expect(r.divisions[1]!.makeups.map((m) => m.week)).toEqual([2]);
  });

  it("counts no makeups when every earlier fixture has a result", () => {
    const r = report(week2, { week: 2 });
    expect(r.makeupCount).toBe(0);
  });

  it("reports an earlier week recorded after play moved on as a late entry", () => {
    // The week-1 Cid/Dee match is entered only after week 2 has started.
    const matches = [
      played("m1", 1, "ann", "bob", "ann"),
      played("m3", 2, "bob", "ann", "bob"),
      played("m2", 1, "cid", "dee", "dee"),
    ];
    const r = report(matches, { week: 3 });
    expect(r.divisions[0]!.results.map((x) => x.matchId)).toEqual(["m3"]);
    expect(r.divisions[1]!.lateResults.map((x) => x.matchId)).toEqual(["m2"]);
    // The week-1 match entered before the league moved on is not "late".
    expect(r.divisions[0]!.lateResults).toEqual([]);
  });

  it("reports a forfeit with no games", () => {
    const matches = [
      forfeitMatch({
        id: "f1",
        home: "ann",
        away: "bob",
        winner: "ann",
        week: 1,
        sessionId: SESSION,
      }),
    ];
    const r = report(matches, { week: 2 });
    const result = r.divisions[0]!.results[0]!;
    expect(result.forfeit).toBe(true);
    expect(result.games).toEqual([]);
    expect(result.score).toEqual({ home: 3, away: 0 });
  });

  it("ranks each division on its own games", () => {
    const r = report(week2, { week: 2 });
    expect(r.divisions[0]!.standings.map((s) => s.name)).toEqual(["Ann", "Bob"]);
    expect(r.divisions[1]!.standings.map((s) => s.name)).toEqual(["Dee", "Cid"]);
    expect(r.divisions[0]!.standings[0]!.rank).toBe(1);
  });

  it("lists a player with no fixture this week as a bye", () => {
    const schedule = [fixture(1, "ann", "bob")];
    const r = report([], { week: 1, schedule });
    expect(r.divisions[0]!.byes).toEqual([]);
    expect(r.divisions[1]!.byes.map((b) => b.name)).toEqual(["Cid", "Dee"]);
  });

  it("surfaces a cross-division fixture instead of dropping it", () => {
    const schedule = [...SCHEDULE, fixture(1, "ann", "dee")];
    const r = report([], { week: 1, schedule });
    const other = r.divisions.find((d) => d.id === null);
    expect(other).toBeDefined();
    expect(other!.upcoming.map((f) => f.away.name)).toEqual(["Dee"]);
    expect(other!.standings).toEqual([]);
  });

  it("omits the catch-all group when every match fits a division", () => {
    const r = report(week2, { week: 2 });
    expect(r.divisions.every((d) => d.id !== null)).toBe(true);
  });

  it("infers the week when none is given", () => {
    const r = report(week2);
    expect(r.week).toBe(2);
    expect(r.lastWeek).toBe(1);
  });

  it("rejects a week that is not a positive integer", () => {
    expect(() => report([], { week: 0 })).toThrow(/positive integer/);
  });

  it("falls back to the session id when no label is given", () => {
    const engine = new SimpleProvisionalRatingEngine();
    const ratings = engine.calculateRatings({ players: PLAYERS, matches: [] });
    const league = new LeagueService(PLAYERS, ratings, []);
    const r = buildWeeklyReport(
      league,
      { players: PLAYERS, matches: [], schedule: [], divisions: [] },
      { sessionId: SESSION },
    );
    expect(r.sessionLabel).toBe(SESSION);
  });

  it("runs an undivided session as one group over the given roster", () => {
    const engine = new SimpleProvisionalRatingEngine();
    const ratings = engine.calculateRatings({ players: PLAYERS, matches: [] });
    const league = new LeagueService(PLAYERS, ratings, []);
    const r = buildWeeklyReport(
      league,
      {
        players: PLAYERS,
        matches: [],
        schedule: [fixture(1, "ann", "dee")],
        divisions: [],
        roster: ["ann", "dee"],
      },
      { sessionId: SESSION, week: 1 },
    );
    expect(r.divisions).toHaveLength(1);
    expect(r.divisions[0]!.id).toBeNull();
    expect(r.divisions[0]!.standings.map((s) => s.name)).toEqual(["Ann", "Dee"]);
    expect(r.divisions[0]!.byes).toEqual([]);
  });
});

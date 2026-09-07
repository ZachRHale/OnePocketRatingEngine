import {
  formatBallSpot,
  type BallSpot,
  type Division,
  type Match,
  type Player,
  type PlayerId,
  type SessionId,
} from "../domain/index.js";
import type { PlayerRating } from "../rating/index.js";
import {
  DEFAULT_HANDICAP_TABLE,
  ballSpotForRatings,
  normalizeHandicapTable,
  type HandicapTier,
} from "./handicapTable.js";
import type { LeagueService, Standing } from "./LeagueService.js";
import type { Fixture } from "./schedule.js";

/**
 * Layer 3 — League Logic.
 *
 * The weekly bulletin: what happened last week, who plays this week, what is
 * still owed, and where every division stands. It is the model behind the email
 * that goes out between match nights, and it is *only* a model — no HTML, no
 * text, no formatting decisions. Rendering belongs to whoever is sending the
 * mail; see `server/report.ts` for the two renderers the app ships with.
 *
 * Like the rest of this layer it computes no ratings. It reads recorded facts
 * (Layer 1), asks a {@link LeagueService} for the standings, and takes the spot
 * ratings it needs for upcoming ball spots as an argument.
 */

/** A player as the bulletin names them. */
export interface ReportPlayer {
  id: PlayerId;
  name: string;
}

/** One game inside a reported result: the final ball count for each side. */
export interface ReportGame {
  /** 1-based position within the match. */
  gameNumber: number;
  winner: PlayerId;
  /** Balls the home player pocketed. The winner's total is their target. */
  homeBalls: number;
  /** Balls the away player pocketed. */
  awayBalls: number;
}

/** A completed match, as the bulletin reports it. */
export interface ReportResult {
  matchId: string;
  /** The scheduled week this result belongs to. */
  week: number;
  home: ReportPlayer;
  away: ReportPlayer;
  /** The spot that was in force for this match. */
  spot: BallSpot;
  /** That spot in "8-7" notation, oriented home-away. */
  formattedSpot: string;
  winner: ReportPlayer;
  loser: ReportPlayer;
  /** Games won by each side, e.g. `{ home: 3, away: 1 }`. */
  score: { home: number; away: number };
  /** Awarded, not played: no games, no ball counts. */
  forfeit: boolean;
  /** Every game in order. Empty for a {@link ReportResult.forfeit}. */
  games: ReportGame[];
}

/** A scheduled pairing: this week's, or one still owed from an earlier week. */
export interface ReportFixture {
  week: number;
  home: ReportPlayer;
  away: ReportPlayer;
  /**
   * The spot as of right now, or `null` when no spot ratings were supplied (or
   * a player has none). Spot ratings re-base every time a player finishes
   * another block of games (see `spotRatingsFor`), so a spot printed for a
   * fixture that is weeks out is a current best guess, not a promise.
   */
  spot: BallSpot | null;
  formattedSpot: string | null;
  /** Whether a result has already been recorded for this fixture. */
  played: boolean;
}

/**
 * One division's page of the bulletin. An undivided session (a playoff bracket,
 * a small league) produces a single group with `id: null`.
 */
export interface DivisionReport {
  /** Division id, or `null` for an undivided session or the catch-all group. */
  id: string | null;
  label: string;
  /** Last week's results, in the order they were recorded. */
  results: ReportResult[];
  /**
   * Results from BEFORE last week that were recorded after play moved on —
   * makeups that have since been settled. See {@link buildWeeklyReport} for why
   * the game log's own order is the only clock available here.
   */
  lateResults: ReportResult[];
  /** This week's fixtures. */
  upcoming: ReportFixture[];
  /** Players in this group with no fixture this week. */
  byes: ReportPlayer[];
  /** Fixtures from earlier weeks with no result yet — the makeups owed. */
  makeups: ReportFixture[];
  /** This group's standings for the session. Empty for the catch-all group. */
  standings: Standing[];
}

/** Everything one week's email needs. */
export interface WeeklyReport {
  sessionId: SessionId;
  sessionLabel: string;
  /** The week being previewed — "this week". */
  week: number;
  /** The week being reported on, or `null` when {@link WeeklyReport.week} is 1. */
  lastWeek: number | null;
  divisions: DivisionReport[];
  /** Total makeups owed across every group. */
  makeupCount: number;
}

/** The recorded state a bulletin is built from. */
export interface WeeklyReportInput {
  players: readonly Player[];
  matches: readonly Match[];
  schedule: readonly Fixture[];
  /** The session's divisions. Empty means undivided. */
  divisions: readonly Division[];
  /**
   * The session roster. Only consulted for an undivided session — a divided one
   * takes its rosters from the divisions. Omit and the roster is derived from
   * whoever appears in the session's matches and fixtures.
   */
  roster?: readonly PlayerId[];
}

export interface WeeklyReportOptions {
  /** The session to report on. */
  sessionId: SessionId;
  /** Human-facing session name. Defaults to `sessionId`. */
  sessionLabel?: string;
  /** The week to preview. Defaults to {@link currentWeekFor}. */
  week?: number;
  /**
   * The ratings that set ball spots — `spotRatingsFor(...)`, NOT the live
   * ratings. Omit and upcoming fixtures carry no spot, which is better than
   * printing a spot the league would not actually play to.
   */
  spotRatings?: readonly PlayerRating[];
  /** Ball-spot ladder. Defaults to {@link DEFAULT_HANDICAP_TABLE}. */
  handicapTable?: readonly HandicapTier[];
}

/** Label for the group holding matches that fit none of the divisions. */
const CATCH_ALL_LABEL = "Other matches";

/** Label used when a session has no divisions at all. */
const UNDIVIDED_LABEL = "All players";

/**
 * The week the league is currently on.
 *
 * A week is "current" from the moment it has a result until every one of its
 * scheduled fixtures does:
 *
 *   - no results at all in the session → week 1;
 *   - otherwise the latest week holding a result, unless that week is complete
 *     (every scheduled fixture played), in which case the week after it.
 *
 * The awkward case this is built for is the makeup: week 1 sitting at seven of
 * eight played does not hold the league at week 1, because the moment a week-2
 * result lands the league has plainly moved on. Only the *latest* week can hold
 * things up, and it does so exactly while it is still being played.
 *
 * It is a heuristic over a log with no dates, so it is a default, not a ruling —
 * pass an explicit `week` whenever it guesses wrong.
 */
export function currentWeekFor(
  matches: readonly Match[],
  schedule: readonly Fixture[],
  sessionId: SessionId,
): number {
  const played = matches.filter((m) => m.sessionId === sessionId);
  if (played.length === 0) return 1;

  const latest = Math.max(...played.map((m) => m.week));
  const scheduled = schedule.filter(
    (f) => f.sessionId === sessionId && f.week === latest,
  );
  const recorded = resultKeys(played);
  const complete =
    scheduled.length > 0 &&
    scheduled.every((f) => recorded.has(pairKey(f.week, f.home, f.away)));

  return complete ? latest + 1 : latest;
}

/**
 * Builds the weekly bulletin for one session.
 *
 * Fixtures and results are linked on (week, unordered pair), the same rule the
 * schedule view uses: seats can be swapped on the night without breaking the
 * link, but a fixture played in a different week reads as unplayed — the
 * truthful answer, since the schedule and the game log then genuinely disagree.
 *
 * **On "last week's results".** A match carries the week it was *scheduled*
 * for, not the night it was played, and the log has no dates at all. So a week-1
 * makeup played during week 2 is still a week-1 match, and reporting strictly by
 * week number would leave it out of every bulletin. Instead, last week's matches
 * are `results`, and any older match sitting *after* the first week-N-or-later
 * match in the log is reported separately as a `lateResult` — append order being
 * the only "recorded since" the data has. It is a cheap heuristic, and the worst
 * it can do is mention a settled makeup in the wrong week's email.
 *
 * @param league  Built over the same players, ratings and matches; it supplies
 *                the standings and nothing else.
 * @param input   The recorded state — roster, game log, schedule, divisions.
 */
export function buildWeeklyReport(
  league: LeagueService,
  input: WeeklyReportInput,
  options: WeeklyReportOptions,
): WeeklyReport {
  const { sessionId } = options;
  const matches = input.matches.filter((m) => m.sessionId === sessionId);
  const fixtures = input.schedule.filter((f) => f.sessionId === sessionId);

  const week =
    options.week ?? currentWeekFor(input.matches, input.schedule, sessionId);
  if (!Number.isInteger(week) || week < 1) {
    throw new Error(`week must be a positive integer, got ${week}`);
  }
  const lastWeek = week > 1 ? week - 1 : null;

  const nameById = new Map(input.players.map((p) => [p.id, p.name]));
  const named = (id: PlayerId): ReportPlayer => ({
    id,
    name: nameById.get(id) ?? id,
  });

  const table = normalizeHandicapTable(
    options.handicapTable ?? DEFAULT_HANDICAP_TABLE,
  );
  const spotRatingById = new Map(
    (options.spotRatings ?? []).map((r) => [r.playerId, r.leagueRating]),
  );
  const spotFor = (home: PlayerId, away: PlayerId): BallSpot | null => {
    const hr = spotRatingById.get(home);
    const ar = spotRatingById.get(away);
    if (hr === undefined || ar === undefined) return null;
    return ballSpotForRatings(table, hr, ar);
  };

  const recorded = resultKeys(matches);
  const toFixture = (f: Fixture): ReportFixture => {
    const spot = spotFor(f.home, f.away);
    return {
      week: f.week,
      home: named(f.home),
      away: named(f.away),
      spot,
      formattedSpot: spot ? formatBallSpot(spot) : null,
      played: recorded.has(pairKey(f.week, f.home, f.away)),
    };
  };

  // Late results: an earlier week's match recorded after play moved on to
  // `lastWeek` or beyond. Append order is the clock (see the doc comment).
  const movedOn =
    lastWeek === null ? -1 : matches.findIndex((m) => m.week >= lastWeek);
  const isLate = (index: number, m: Match): boolean =>
    lastWeek !== null && movedOn >= 0 && index > movedOn && m.week < lastWeek;

  const groups = groupsFor(input.divisions, sessionRoster(input, matches, fixtures));

  const divisions: DivisionReport[] = groups.map((group) => {
    const roster = new Set(group.playerIds);
    // A division owns a pairing when both players are on its roster. The
    // catch-all owns whatever no division does — a hand-edited crossover, or a
    // player added to the schedule but never to a division.
    const owns = (a: PlayerId, b: PlayerId): boolean =>
      group.id === null && input.divisions.length > 0
        ? !input.divisions.some(
            (d) => d.playerIds.includes(a) && d.playerIds.includes(b),
          )
        : roster.has(a) && roster.has(b);

    const mine = matches
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => owns(m.home, m.away));
    const myFixtures = fixtures.filter((f) => owns(f.home, f.away));
    const thisWeek = myFixtures.filter((f) => f.week === week);
    const playing = new Set(thisWeek.flatMap((f) => [f.home, f.away]));

    return {
      id: group.id,
      label: group.label,
      results: mine
        .filter(({ m }) => m.week === lastWeek)
        .map(({ m }) => reportResult(m, named)),
      lateResults: mine
        .filter(({ m, index }) => isLate(index, m))
        .map(({ m }) => reportResult(m, named)),
      upcoming: thisWeek.map(toFixture),
      byes: group.playerIds.filter((id) => !playing.has(id)).map(named),
      makeups: myFixtures
        .filter(
          (f) =>
            f.week < week && !recorded.has(pairKey(f.week, f.home, f.away)),
        )
        .map(toFixture),
      standings: group.catchAll
        ? []
        : league.standings(sessionId, { playerIds: group.playerIds }),
    };
  });

  // Keep the catch-all group only when it actually caught something.
  const kept = divisions.filter(
    (d, i) =>
      !groups[i]!.catchAll ||
      d.results.length +
        d.lateResults.length +
        d.upcoming.length +
        d.makeups.length >
        0,
  );

  return {
    sessionId,
    sessionLabel: options.sessionLabel ?? sessionId,
    week,
    lastWeek,
    divisions: kept,
    makeupCount: kept.reduce((sum, d) => sum + d.makeups.length, 0),
  };
}

interface ReportGroup {
  id: string | null;
  label: string;
  playerIds: PlayerId[];
  /** The bucket for pairings no division owns; it gets no standings. */
  catchAll: boolean;
}

/** The groups a bulletin is split into: the divisions, plus a catch-all. */
function groupsFor(
  divisions: readonly Division[],
  roster: PlayerId[],
): ReportGroup[] {
  if (divisions.length === 0) {
    return [
      { id: null, label: UNDIVIDED_LABEL, playerIds: roster, catchAll: false },
    ];
  }
  return [
    ...divisions.map((d) => ({
      id: d.id,
      label: d.label,
      playerIds: [...d.playerIds],
      catchAll: false,
    })),
    { id: null, label: CATCH_ALL_LABEL, playerIds: [], catchAll: true },
  ];
}

/**
 * The roster of an undivided session: whoever the caller named, else everyone
 * who appears in the session's results or fixtures, in first-seen order.
 */
function sessionRoster(
  input: WeeklyReportInput,
  matches: readonly Match[],
  fixtures: readonly Fixture[],
): PlayerId[] {
  if (input.roster) return [...new Set(input.roster)];
  const seen = new Set<PlayerId>();
  for (const m of matches) {
    seen.add(m.home);
    seen.add(m.away);
  }
  for (const f of fixtures) {
    seen.add(f.home);
    seen.add(f.away);
  }
  return [...seen];
}

function reportResult(
  m: Match,
  named: (id: PlayerId) => ReportPlayer,
): ReportResult {
  const homeWon = m.winner === m.home;
  return {
    matchId: m.id,
    week: m.week,
    home: named(m.home),
    away: named(m.away),
    spot: m.ballSpot,
    formattedSpot: formatBallSpot(m.ballSpot),
    winner: named(m.winner),
    loser: named(homeWon ? m.away : m.home),
    score: { home: m.score.home, away: m.score.away },
    forfeit: m.forfeit === true,
    games: m.games.map((g) => ({
      gameNumber: g.gameNumber,
      winner: g.winner,
      homeBalls: g.ballsMade.home,
      awayBalls: g.ballsMade.away,
    })),
  };
}

/** Canonical key for "this pairing, this week", independent of seats. */
function pairKey(week: number, a: PlayerId, b: PlayerId): string {
  return `${week}|${[a, b].sort().join("|")}`;
}

/** The (week, pairing) keys that already have a result. */
function resultKeys(matches: readonly Match[]): Set<string> {
  return new Set(matches.map((m) => pairKey(m.week, m.home, m.away)));
}

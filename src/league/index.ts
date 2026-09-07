/**
 * Layer 3 — League Logic.
 *
 * Runs the league by querying already-computed ratings. It never calculates a
 * rating; that is Layer 2's job. It owns league concerns like the handicap
 * table, ball-spot lookup, and standings.
 */
export { LeagueService } from "./LeagueService.js";
export type {
  Standing,
  LeagueServiceOptions,
  StandingsOptions,
} from "./LeagueService.js";
export { computePlayerRecords } from "./playerRecords.js";
export type { PlayerRecord } from "./playerRecords.js";
export {
  DEFAULT_HANDICAP_TABLE,
  normalizeHandicapTable,
  tierForGap,
  ballSpotForRatings,
} from "./handicapTable.js";
export type { HandicapTier } from "./handicapTable.js";
export {
  buildSchedule,
  fixturesToWeeks,
  fixturesFor,
} from "./schedule.js";
export type {
  ScheduledMatch,
  WeekSchedule,
  ScheduleOptions,
  Fixture,
  ScheduledWeek,
} from "./schedule.js";
export { matchesInSession } from "./sessions.js";
export { draftDivisions } from "./divisions.js";
export type { DraftEntry, DraftDivisionsOptions } from "./divisions.js";
export { spotRatingsFor, SPOT_REFRESH_GAMES } from "./spotRatings.js";
export { buildWeeklyReport, currentWeekFor } from "./weeklyReport.js";
export type {
  WeeklyReport,
  WeeklyReportInput,
  WeeklyReportOptions,
  DivisionReport,
  ReportResult,
  ReportFixture,
  ReportGame,
  ReportPlayer,
} from "./weeklyReport.js";

/**
 * Layer 3 — League Logic.
 *
 * Runs the league by querying already-computed ratings. It never calculates a
 * rating; that is Layer 2's job. It owns league concerns like the handicap
 * table, ball-spot lookup, and standings.
 */
export { LeagueService } from "./LeagueService.js";
export type { Standing, LeagueServiceOptions } from "./LeagueService.js";
export { computePlayerRecords } from "./playerRecords.js";
export type { PlayerRecord } from "./playerRecords.js";
export {
  DEFAULT_HANDICAP_TABLE,
  normalizeHandicapTable,
  tierForGap,
  ballSpotForRatings,
} from "./handicapTable.js";
export type { HandicapTier } from "./handicapTable.js";
export { buildSchedule } from "./schedule.js";
export type {
  ScheduledMatch,
  WeekSchedule,
  ScheduleOptions,
} from "./schedule.js";
export {
  matchesInSession,
  frozenRatingsForSession,
  ratingsAfterSession,
} from "./sessions.js";

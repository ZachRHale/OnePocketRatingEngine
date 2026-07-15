/**
 * Persistence seam.
 *
 * The league is stored as an append-only game log. {@link LeagueRepository} is
 * the interface the rest of the app depends on; {@link CsvLeagueStore} is the
 * CSV implementation. Swap in a database-backed store later without touching the
 * domain, the rating engine, or the league logic.
 */
export type {
  LeagueRepository,
  LeagueData,
  NewMatch,
  NewPlayer,
  GameResultInput,
  CsvLeagueStoreOptions,
} from "./csvStore.js";
export { CsvLeagueStore } from "./csvStore.js";

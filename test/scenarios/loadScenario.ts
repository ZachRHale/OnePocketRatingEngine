import { CsvLeagueStore, type LeagueData } from "../../src/index.js";

/**
 * A loaded scenario: roster, matches, and the sessions they belong to — ready
 * to hand straight to a rating engine and a `LeagueService`.
 */
export type Scenario = LeagueData;

/**
 * Loads a scenario from a directory of CSV fixtures. This is a thin wrapper over
 * the library's {@link CsvLeagueStore} — the same append-only game log the app
 * runs on — so scenarios exercise the real persistence path, not a parallel
 * loader. See {@link CsvLeagueStore} for the file formats and the per-session
 * frozen ball-spot policy.
 */
export function loadScenario(dir: string): Scenario {
  return new CsvLeagueStore(dir).load();
}

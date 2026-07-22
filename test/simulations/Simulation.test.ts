import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { SimpleProvisionalRatingEngine } from "../../src/index.js";
import {
  buildSchedule,
  LeagueService,
  SPOT_REFRESH_GAMES,
  spotRatingsFor,
} from "../../src/league/index.js";
import { loadScenario } from "../scenarios/loadScenario.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "scenarios", "data");

const engine = () => new SimpleProvisionalRatingEngine();

describe("Simulated League", () => {
  describe("simulated scenarios", () => {
    it("runs a multi-session season", () => {
      // Roster, matches, sessions and ball spots all come from CSV — swap the
      // folder to run the same assertions against a different data set.
      const { players, matches, sessions } = loadScenario(
        join(dataDir, "season-2026"),
      );

      const ratings = engine().calculateRatings({ players, matches });
      const service = new LeagueService(players, ratings, matches);

      // Standings reset each session; skill accumulates continuously.
      for (const session of sessions) {
        console.log(`\n=== ${session.label} standings ===`);
        console.log(service.standings(session.id));
      }
      console.log("\n=== all-time ratings ===");
      console.log(ratings);

      // Every session's standings still list the full roster.
      for (const session of sessions) {
        expect(service.standings(session.id)).toHaveLength(players.length);
      }
    });

    it("re-bases ball spots per player every 20 games", () => {
      const { players, matches } = loadScenario(join(dataDir, "season-2026"));

      const spot = spotRatingsFor(engine(), players, matches);
      const live = engine().calculateRatings({ players, matches });
      const liveById = new Map(live.map((r) => [r.playerId, r]));

      for (const s of spot) {
        // A player's spot is frozen at a 20-game boundary: it sits at their
        // Fargo seed (0 games) until they clear 20, and never in between.
        expect(s.gamesPlayed === 0 || s.gamesPlayed >= SPOT_REFRESH_GAMES).toBe(
          true,
        );
        // The spot can only lag the live rating, never lead it.
        expect(s.gamesPlayed).toBeLessThanOrEqual(
          liveById.get(s.playerId)!.gamesPlayed,
        );
      }

      // The scenario is long enough that at least one player has re-based.
      expect(spot.some((s) => s.gamesPlayed >= SPOT_REFRESH_GAMES)).toBe(true);
    });

    it("generates weekly matchups with byes for a session roster", () => {
      const { sessions } = loadScenario(join(dataDir, "season-2026"));
      const roster = [
        "Jay",
        "Zach",
        "Wiley",
        "Lucas",
        "Jesse",
        "Jason",
        "Will",
        "Jeff",
        "George",
      ];

      // Rotate the bye offset by session index so extra byes move across sessions.
      const schedule = buildSchedule(roster, roster.length, {
        rotation: sessions.length,
      });
      console.log(
        schedule.map((w) => ({
          week: w.week,
          bye: w.bye,
          matchups: w.matches.map((m) => `${m.home} vs ${m.away}`),
        })),
      );

      expect(new Set(schedule.map((w) => w.bye))).toEqual(new Set(roster));
    });
  });
});

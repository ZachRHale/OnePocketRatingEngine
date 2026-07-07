import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { SimpleProvisionalRatingEngine } from "../../src/index.js";
import {
  buildSchedule,
  frozenRatingsForSession,
  LeagueService,
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

      // Standings reset each session; ratings carry across them.
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

    it("freezes ball spots per session from carried-over ratings", () => {
      const { players, matches, sessions } = loadScenario(
        join(dataDir, "season-2026"),
      );

      // Summer's spots use ratings frozen at summer's start, i.e. after spring —
      // so Jay/Lucas need not be seeded at their Fargo gap anymore.
      const summer = sessions.find((s) => s.id === "summer-2026")!;
      const frozen = frozenRatingsForSession(
        engine(),
        players,
        matches,
        sessions,
        summer.id,
      );
      const jay = frozen.find((r) => r.playerId === "Jay")!;
      expect(jay.gamesPlayed).toBeGreaterThan(0); // reflects spring play
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

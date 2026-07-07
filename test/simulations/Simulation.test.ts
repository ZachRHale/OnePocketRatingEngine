import { describe, it, expect } from "vitest";
import {
  SimpleProvisionalRatingEngine,
  type PlayerRating,
} from "../../src/index.js";
import { match, player, win, wins } from "../factories.js";
import {
  ballSpotForRatings,
  DEFAULT_HANDICAP_TABLE,
  LeagueService,
} from "../../src/league/index.js";

const engine = () => new SimpleProvisionalRatingEngine();

function ratingOf(ratings: PlayerRating[], id: string): PlayerRating {
  const r = ratings.find((x) => x.playerId === id);
  if (!r) throw new Error(`no rating for ${id}`);
  return r;
}

describe("Simulated League", () => {
  describe("simulated scenarios", () => {
    it("runs an entire season", () => {
      const players = [
        player("Jay", 622, "Jay Winters"),
        player("Zach", 450, "Zach Hale"),
        player("Wiley", 553, "Michael Wiley"),
        player("Lucas", 506, "Lucas Darocha"),
        player("Jesse", 534, "Jesse Daschbach"),
        player("Jason", 536, "Jason Hobert"),
        player("Will", 500, "Will ?"),
        player("Jeff", 440, "Jeff Shelquist"),
        player("George", 433, "George McMillian"),
      ];
      const matches = [
        match({
          id: "m1",
          home: "Jay",
          away: "Zach",
          games: [
            { winner: "Jay", loserBalls: 3 },
            { winner: "Zach", loserBalls: 7 },
            { winner: "Zach", loserBalls: 7 },
            { winner: "Jay", loserBalls: 4 },
            { winner: "Jay", loserBalls: 0 },
          ],
          ballSpot: ballSpotForRatings(DEFAULT_HANDICAP_TABLE, 622, 450),
        }),
        match({
          id: "m2",
          home: "Jay",
          away: "Wiley",
          games: [
            { winner: "Jay", loserBalls: 5 },
            { winner: "Wiley", loserBalls: 3 },
            { winner: "Wiley", loserBalls: 6 },
            { winner: "Wiley", loserBalls: 5 },
          ],
          ballSpot: ballSpotForRatings(DEFAULT_HANDICAP_TABLE, 622, 553),
        }),
        match({
          id: "m3",
          home: "Jay",
          away: "Lucas",
          games: [
            { winner: "Jay", loserBalls: 5 },
            { winner: "Lucas", loserBalls: 7 },
            { winner: "Lucas", loserBalls: 3 },
            { winner: "Jay", loserBalls: 0 },
            { winner: "Jay", loserBalls: 2 },
          ],
          ballSpot: ballSpotForRatings(DEFAULT_HANDICAP_TABLE, 622, 506),
        }),
        match({
          id: "m4",
          home: "Wiley",
          away: "Zach",
          games: [
            { winner: "Wiley", loserBalls: 5 },
            { winner: "Zach", loserBalls: 7 },
            { winner: "Wiley", loserBalls: 2 },
            { winner: "Wiley", loserBalls: 3 },
          ],
          ballSpot: ballSpotForRatings(DEFAULT_HANDICAP_TABLE, 553, 450),
        }),
        match({
          id: "m5",
          home: "Jay",
          away: "Lucas",
          games: [
            { winner: "Jay", loserBalls: 5 },
            { winner: "Lucas", loserBalls: 7 },
            { winner: "Lucas", loserBalls: 3 },
            { winner: "Jay", loserBalls: 0 },
            { winner: "Jay", loserBalls: 2 },
          ],
          ballSpot: ballSpotForRatings(DEFAULT_HANDICAP_TABLE, 622, 506),
        }),
      ];
      const ratings = engine().calculateRatings({ players, matches });

      //   const Jay = ratingOf(ratings, "Jay");

      console.log(ratings);

      // Standings now need the raw matches too (win% + loss-closeness ranking).
      const service = () => new LeagueService(players, ratings, matches);

      console.log(service().standings());
    });
  });
});

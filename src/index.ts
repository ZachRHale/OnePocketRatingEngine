/**
 * league-calculator — a one-pocket billiards league rating system.
 *
 * The architecture keeps three concerns strictly separate so the rating
 * algorithm can evolve without disturbing the data model or the league:
 *
 *   Layer 1 — domain/  Immutable match data (Players, Matches, Games). Facts only.
 *   Layer 2 — rating/  The RatingEngine seam: consumes history, produces ratings.
 *   Layer 3 — league/  League logic: asks questions of ratings, never computes them.
 *
 * A typical flow:
 *
 *   const engine = new SimpleProvisionalRatingEngine();
 *   const ratings = engine.calculateRatings({ players, matches });
 *   const league = new LeagueService(players, ratings);
 *   league.standings();
 *   league.ballSpotFor(homeId, awayId);
 */

// Layer 1 — Raw Match Data
export * from "./domain/index.js";

// Layer 2 — Rating Engine
export * from "./rating/index.js";

// Layer 3 — League Logic
export * from "./league/index.js";

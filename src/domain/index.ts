/**
 * Layer 1 — Raw Match Data.
 *
 * The immutable data model. This layer knows nothing about how ratings are
 * calculated or how the league is run; it only describes the facts that are
 * stored permanently. Everything here is a plain type or a tiny pure
 * constructor — no algorithm, no persistence.
 */
export type { PlayerId, MatchId, GameId, SessionId } from "./ids.js";
export type { Session } from "./session.js";
export type { BallSpot } from "./ballSpot.js";
export { homeSpotAdvantage, formatBallSpot } from "./ballSpot.js";
export type { Game } from "./game.js";
export type { Match, MatchScore } from "./match.js";
export { RACE_TO_GAMES } from "./match.js";
export type { Player } from "./player.js";
export { seedPlayer } from "./player.js";

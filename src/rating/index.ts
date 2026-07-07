/**
 * Layer 2 — Rating Engine.
 *
 * Consumes historical match data (Layer 1) and produces player ratings. The
 * algorithm lives entirely behind the {@link RatingEngine} interface so it can
 * be replaced or compared without touching the data model or league logic.
 */
export type {
  RatingEngine,
  RatingInput,
  PlayerRating,
} from "./RatingEngine.js";
export { SimpleProvisionalRatingEngine } from "./SimpleProvisionalRatingEngine.js";
export type { SimpleProvisionalOptions } from "./SimpleProvisionalRatingEngine.js";

import type { PlayerId } from "./ids.js";

/**
 * Layer 1 — Raw Match Data.
 *
 * A league player. Two kinds of data live here:
 *
 *  - **Facts / seeds:** `id`, `name`, and `fargoRating`. After initial seeding,
 *    Fargo is never used again except to seed a brand-new player joining the
 *    league. The League Rating is the authoritative rating thereafter.
 *
 *  - **Derived snapshot cache:** `leagueRating`, `confidence`, `provisional`,
 *    and `gamesPlayed`. These are NOT independent facts — they are a
 *    materialized copy of the latest {@link RatingEngine} output, stored on the
 *    player row so Layer 3 can answer "what is this rating?" without recomputing
 *    from history on every read. The authoritative source is always the rating
 *    engine run over the full match history; this cache can be rebuilt at any
 *    time. On creation, seed `leagueRating := fargoRating`, `provisional :=
 *    true`, `gamesPlayed := 0`.
 */
export interface Player {
  id: PlayerId;
  name: string;

  /** Seed rating. Used only to initialize `leagueRating` and for new joiners. */
  fargoRating: number;

  // --- Derived snapshot cache (see class doc) ---
  leagueRating: number;
  confidence: number;
  provisional: boolean;
  gamesPlayed: number;
}

/**
 * Builds a freshly-seeded player: League Rating equals Fargo, provisional, zero
 * games. This is the only place Fargo flows into League Rating.
 */
export function seedPlayer(
  id: PlayerId,
  name: string,
  fargoRating: number,
): Player {
  return {
    id,
    name,
    fargoRating,
    leagueRating: fargoRating,
    confidence: 0,
    provisional: true,
    gamesPlayed: 0,
  };
}

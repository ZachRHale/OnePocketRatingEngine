import type { Game, Match, PlayerId } from "../domain/index.js";
import { homeSpotAdvantage } from "../domain/index.js";
import type {
  PlayerRating,
  RatingEngine,
  RatingInput,
} from "./RatingEngine.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export interface SimpleProvisionalOptions {
  /**
   * Elo K-factor applied per GAME (not per match). Higher = more volatile.
   * Because updates happen game-by-game, a full 3-2 match can move a rating by
   * up to ~5×K before the provisional multiplier.
   */
  kFactor?: number;
  /**
   * While a player is provisional, their K is multiplied by this so new
   * players converge toward their true rating faster.
   */
  provisionalMultiplier?: number;
  /**
   * Rating points that one ball of spot is worth. Used to fold the ball spot
   * into the win expectation: a correctly-set spot should make the expected
   * game-win probability ~0.5 for evenly-matched-after-spot players.
   */
  pointsPerBall?: number;
  /** Games played at or above which a player is no longer provisional. */
  provisionalGames?: number;
  /** Games played at which confidence reaches 1.0 (scales linearly up to it). */
  confidenceGames?: number;
  /** Trend = net rating change over this many most-recent matches. */
  trendWindow?: number;
  /**
   * How strongly the margin of victory (balls the loser made vs. their target)
   * scales a game's rating swing, in [0, 1]. A decisive win (shutout) moves
   * ratings more than a hill-hill game; a game where the loser reached half
   * their target is treated as "typical" and left unscaled. `0` disables margin
   * and reverts to pure win/loss. At `w`, the per-game multiplier ranges over
   * `[1 - w, 1 + w]`.
   */
  marginWeight?: number;
}

const DEFAULTS = {
  kFactor: 12,
  provisionalMultiplier: 2,
  pointsPerBall: 40,
  provisionalGames: 20,
  confidenceGames: 50,
  trendWindow: 3,
  marginWeight: 0.5,
} as const;

/** Mutable per-player accumulator used only inside a single calculation pass. */
interface RatingState {
  rating: number;
  gamesPlayed: number;
  /** Net rating delta of each match this player appeared in, in order. */
  matchDeltas: number[];
}

/**
 * Layer 2 — Rating Engine (first implementation).
 *
 * A deliberately simple, provisional engine: per-game Elo with the ball spot
 * folded into the win expectation and the margin of victory scaling each game's
 * swing. It consumes far more than "who won the match" — it reacts to each
 * individual game, to the handicap in effect, and to how decisive each game was
 * (balls the loser made vs. their target). It intentionally does NOT yet use
 * strength of schedule or expected-vs-actual streak analysis; those are the
 * natural next steps and are marked below. Swap this whole class out via the
 * {@link RatingEngine} interface when a better model is ready — nothing in
 * Layers 1 or 3 needs to change.
 */
export class SimpleProvisionalRatingEngine implements RatingEngine {
  readonly name = "simple-provisional";

  readonly kFactor: number;
  readonly provisionalMultiplier: number;
  readonly pointsPerBall: number;
  readonly provisionalGames: number;
  readonly confidenceGames: number;
  readonly trendWindow: number;
  readonly marginWeight: number;

  constructor(options: SimpleProvisionalOptions = {}) {
    this.kFactor = options.kFactor ?? DEFAULTS.kFactor;
    this.provisionalMultiplier =
      options.provisionalMultiplier ?? DEFAULTS.provisionalMultiplier;
    this.pointsPerBall = options.pointsPerBall ?? DEFAULTS.pointsPerBall;
    this.provisionalGames =
      options.provisionalGames ?? DEFAULTS.provisionalGames;
    this.confidenceGames = options.confidenceGames ?? DEFAULTS.confidenceGames;
    this.trendWindow = options.trendWindow ?? DEFAULTS.trendWindow;
    this.marginWeight = options.marginWeight ?? DEFAULTS.marginWeight;

    this.requirePositive("kFactor", this.kFactor);
    this.requirePositive("provisionalMultiplier", this.provisionalMultiplier);
    this.requireFinite("pointsPerBall", this.pointsPerBall);
    this.requirePositive("provisionalGames", this.provisionalGames);
    this.requirePositive("confidenceGames", this.confidenceGames);
    this.requirePositive("trendWindow", this.trendWindow);
    this.requireInRange("marginWeight", this.marginWeight, 0, 1);
  }

  /**
   * Probability (0..1) that `ratingA` beats `ratingB` at even terms, per the
   * logistic Elo curve. `expectedScore(a, b) + expectedScore(b, a) === 1`.
   */
  expectedScore(ratingA: number, ratingB: number): number {
    return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  }

  calculateRatings(input: RatingInput): PlayerRating[] {
    const state = new Map<PlayerId, RatingState>();

    for (const player of input.players) {
      state.set(player.id, {
        rating: player.leagueRating,
        gamesPlayed: 0,
        matchDeltas: [],
      });
    }

    for (const match of input.matches) {
      this.applyMatch(match, state);
    }

    return input.players.map((player) => {
      const s = state.get(player.id)!;
      return {
        playerId: player.id,
        leagueRating: Math.round(s.rating),
        confidence: this.confidenceFor(s.gamesPlayed),
        provisional: s.gamesPlayed < this.provisionalGames,
        trend: this.trendFor(s.matchDeltas),
        gamesPlayed: s.gamesPlayed,
      };
    });
  }

  private applyMatch(match: Match, state: Map<PlayerId, RatingState>): void {
    if (match.home === match.away) {
      throw new Error(`A player cannot play themselves: "${match.home}"`);
    }
    const home = state.get(match.home);
    const away = state.get(match.away);
    if (!home || !away) {
      const missing = !home ? match.home : match.away;
      throw new Error(
        `Match ${match.id} references unknown player "${missing}" — every ` +
          `match participant must appear in RatingInput.players`,
      );
    }

    // Expectation is fixed for the whole match (ratings do not drift mid-match).
    // Fold the ball spot in as a rating offset: if home must pocket more balls,
    // the spot is compensating for home being the stronger side, so we discount
    // home's raw rating edge by that much.
    const spotOffset = this.pointsPerBall * homeSpotAdvantage(match.ballSpot);
    const expectedHome = this.expectedScore(
      home.rating - spotOffset,
      away.rating,
    );

    const homeK =
      this.kFactor *
      (home.gamesPlayed < this.provisionalGames
        ? this.provisionalMultiplier
        : 1);
    const awayK =
      this.kFactor *
      (away.gamesPlayed < this.provisionalGames
        ? this.provisionalMultiplier
        : 1);

    let homeDelta = 0;
    let awayDelta = 0;
    for (const game of match.games) {
      const actualHome = game.winner === match.home ? 1 : 0;
      // Scale the swing by how decisive the game was: a shutout is stronger
      // evidence than a hill-hill win, so it moves ratings more. The multiplier
      // is a property of the game, applied equally to both sides.
      const margin = this.marginMultiplier(match, game);
      homeDelta += homeK * margin * (actualHome - expectedHome);
      awayDelta += awayK * margin * (1 - actualHome - (1 - expectedHome));
    }

    home.rating += homeDelta;
    away.rating += awayDelta;
    home.gamesPlayed += match.games.length;
    away.gamesPlayed += match.games.length;
    home.matchDeltas.push(homeDelta);
    away.matchDeltas.push(awayDelta);
  }

  /**
   * Per-game swing multiplier from the margin of victory. Decisiveness is how
   * far short of their target the loser finished, normalized to [0, 1]: 1 is a
   * shutout, 0 is the loser reaching their target (i.e. no margin). The
   * multiplier is `1 + marginWeight * (2·decisiveness − 1)`, so a game where the
   * loser reached half their target is unscaled, and it ranges over
   * `[1 − marginWeight, 1 + marginWeight]`.
   */
  private marginMultiplier(match: Match, game: Game): number {
    if (this.marginWeight === 0) {
      return 1;
    }
    const homeWon = game.winner === match.home;
    const loserTarget = homeWon ? game.target.away : game.target.home;
    const loserMade = homeWon ? game.ballsMade.away : game.ballsMade.home;
    if (loserTarget <= 0) {
      return 1;
    }
    const decisiveness = clamp01((loserTarget - loserMade) / loserTarget);
    return 1 + this.marginWeight * (2 * decisiveness - 1);
  }

  private confidenceFor(gamesPlayed: number): number {
    return Math.min(1, gamesPlayed / this.confidenceGames);
  }

  private trendFor(matchDeltas: number[]): number {
    const window = matchDeltas.slice(-this.trendWindow);
    const sum = window.reduce((acc, d) => acc + d, 0);
    return Math.round(sum);
  }

  private requirePositive(name: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(
        `${name} must be a positive finite number, got ${value}`,
      );
    }
  }

  private requireFinite(name: string, value: number): void {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${name} must be a finite number, got ${value}`);
    }
  }

  private requireInRange(
    name: string,
    value: number,
    min: number,
    max: number,
  ): void {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(
        `${name} must be a finite number in [${min}, ${max}], got ${value}`,
      );
    }
  }
}

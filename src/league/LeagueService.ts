import type {
  BallSpot,
  Match,
  Player,
  PlayerId,
  SessionId,
} from "../domain/index.js";
import type { PlayerRating } from "../rating/index.js";
import {
  DEFAULT_HANDICAP_TABLE,
  type HandicapTier,
  ballSpotForRatings,
  normalizeHandicapTable,
} from "./handicapTable.js";
import { computePlayerRecords, type PlayerRecord } from "./playerRecords.js";

/**
 * A player's row in the standings. Ranking is driven by actual results
 * (`winPct`, then `ballPct`); the rating fields are carried along for display
 * only and never influence the order.
 */
export interface Standing {
  rank: number;
  playerId: PlayerId;
  name: string;

  // Ranking fields (results-based).
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  winPct: number;
  ballPct: number;
  ballsMade: number;
  ballsAvailable: number;

  // Informational (from the rating engine).
  leagueRating: number;
  provisional: boolean;
  confidence: number;
  trend: number;
}

export interface LeagueServiceOptions {
  /** Ball-spot ladder to use. Defaults to {@link DEFAULT_HANDICAP_TABLE}. */
  handicapTable?: readonly HandicapTier[];
}

/**
 * Layer 3 — League Logic.
 *
 * Runs the league by ASKING questions of already-computed data; it never
 * calculates a rating itself. Construct it with the players (Layer 1), the
 * ratings a {@link RatingEngine} produced (Layer 2), and the raw match history
 * (Layer 1), then answer things like:
 *
 *   - What is this player's League Rating?  → {@link ratingOf}
 *   - Is this player provisional?           → {@link isProvisional}
 *   - What is tonight's ball spot?          → {@link ballSpotFor}
 *   - What are the standings?               → {@link standings}
 *
 * Standings are ranked by results (win percentage, then how close the player's
 * losses were), which are a plain roll-up of match facts — NOT a rating. The
 * ratings are used only for the ball-spot handicap and for display.
 *
 * Because it holds a snapshot, rerunning the engine and rebuilding a
 * `LeagueService` is how the league "sees" updates — there is no mutation path
 * from here back into ratings.
 */
export class LeagueService {
  private readonly players: Map<PlayerId, Player>;
  private readonly ratings: Map<PlayerId, PlayerRating>;
  private readonly matches: readonly Match[];
  private readonly records: Map<PlayerId, PlayerRecord>;
  private readonly handicapTable: HandicapTier[];

  constructor(
    players: readonly Player[],
    ratings: readonly PlayerRating[],
    matches: readonly Match[],
    options: LeagueServiceOptions = {},
  ) {
    this.players = new Map(players.map((p) => [p.id, p]));
    this.ratings = new Map(ratings.map((r) => [r.playerId, r]));
    this.matches = matches;
    this.records = computePlayerRecords(
      matches,
      players.map((p) => p.id),
    );
    this.handicapTable = normalizeHandicapTable(
      options.handicapTable ?? DEFAULT_HANDICAP_TABLE,
    );
  }

  /** The player's full derived rating. Throws if the player is unknown. */
  ratingOf(playerId: PlayerId): PlayerRating {
    const rating = this.ratings.get(playerId);
    if (!rating) {
      throw new Error(`No rating for player "${playerId}"`);
    }
    return rating;
  }

  /** The player's win/loss record and ball stats. Throws if unknown. */
  recordOf(playerId: PlayerId): PlayerRecord {
    const record = this.records.get(playerId);
    if (!record) {
      throw new Error(`No record for player "${playerId}"`);
    }
    return record;
  }

  /** The authoritative League Rating. Throws if the player is unknown. */
  leagueRatingOf(playerId: PlayerId): number {
    return this.ratingOf(playerId).leagueRating;
  }

  /** Whether the player's rating is still provisional. */
  isProvisional(playerId: PlayerId): boolean {
    return this.ratingOf(playerId).provisional;
  }

  /**
   * Tonight's ball spot for a matchup, oriented to home/away. Uses the two
   * players' current League Ratings and the configured handicap table.
   */
  ballSpotFor(homeId: PlayerId, awayId: PlayerId): BallSpot {
    if (homeId === awayId) {
      throw new Error(`A player cannot play themselves: "${homeId}"`);
    }
    return ballSpotForRatings(
      this.handicapTable,
      this.leagueRatingOf(homeId),
      this.leagueRatingOf(awayId),
    );
  }

  /**
   * The standings, ranked by win percentage (desc); ties broken by the share of
   * available balls the player pocketed (`ballPct`, desc — more decisive play
   * beats a blowout loss), then by name. Rank is 1-based and assigned by row
   * order.
   *
   * Pass a `sessionId` for that session's standings only (records reset each
   * session); omit it for all-time standings across every match. Every rostered
   * player is always listed, even with no games that session.
   */
  standings(sessionId?: SessionId): Standing[] {
    const records =
      sessionId === undefined
        ? this.records
        : computePlayerRecords(
            this.matches.filter((m) => m.sessionId === sessionId),
            [...this.players.keys()],
          );

    const rows = [...records.values()].map((record) => {
      const rating = this.ratings.get(record.playerId);
      const player = this.players.get(record.playerId);
      return {
        playerId: record.playerId,
        name: player?.name ?? record.playerId,
        gamesPlayed: record.gamesPlayed,
        gamesWon: record.gamesWon,
        gamesLost: record.gamesLost,
        winPct: record.winPct,
        ballPct: record.ballPct,
        ballsMade: record.ballsMade,
        ballsAvailable: record.ballsAvailable,
        leagueRating: rating?.leagueRating ?? 0,
        provisional: rating?.provisional ?? true,
        confidence: rating?.confidence ?? 0,
        trend: rating?.trend ?? 0,
      };
    });

    rows.sort(
      (a, b) =>
        b.winPct - a.winPct ||
        b.ballPct - a.ballPct ||
        a.name.localeCompare(b.name),
    );

    return rows.map((row, index) => ({ rank: index + 1, ...row }));
  }
}

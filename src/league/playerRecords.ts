import type { Match, PlayerId } from "../domain/index.js";

/**
 * Layer 3 — League Logic (statistics).
 *
 * A player's win/loss record and ball stats, aggregated from raw match data.
 * This is NOT a rating — it is a straight roll-up of immutable facts (who won
 * each game, how many balls each side made), so it belongs to league logic, not
 * the rating engine. Standings are built from these; dashboards can reuse them.
 */
export interface PlayerRecord {
  playerId: PlayerId;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  /** Total balls this player pocketed across every game. */
  ballsMade: number;
  /**
   * Total balls this player *could* have pocketed: the sum of their per-game
   * target across every game played (in a win that target was reached, in a
   * loss it was not). Forfeits add nothing — no games were played.
   */
  ballsAvailable: number;
  /** Games won ÷ games played. `0` when the player has played nothing. */
  winPct: number;
  /**
   * Balls made ÷ balls available over ALL games, in [0, 1]. A win contributes a
   * full target; a loss contributes however many balls were made. This is the
   * standings tiebreaker after win%: among players with the same win%, the one
   * who pocketed a larger share of the balls available to them ranks higher.
   * `0` when the player has no ball data (never played, or only forfeits).
   */
  ballPct: number;
}

/** Mutable accumulator used only while rolling up matches. */
interface RecordAccumulator {
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  ballsMade: number;
  ballsAvailable: number;
}

function emptyAccumulator(): RecordAccumulator {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    ballsMade: 0,
    ballsAvailable: 0,
  };
}

/**
 * Rolls up every game in `matches` into a {@link PlayerRecord} per player.
 * `seedPlayerIds` guarantees a record exists for those players even if they
 * never played (so standings can list everyone); any player appearing in a
 * match is included automatically.
 */
export function computePlayerRecords(
  matches: readonly Match[],
  seedPlayerIds: Iterable<PlayerId> = [],
): Map<PlayerId, PlayerRecord> {
  const acc = new Map<PlayerId, RecordAccumulator>();
  const accFor = (id: PlayerId): RecordAccumulator => {
    let a = acc.get(id);
    if (!a) {
      a = emptyAccumulator();
      acc.set(id, a);
    }
    return a;
  };

  for (const id of seedPlayerIds) {
    accFor(id);
  }

  for (const match of matches) {
    const home = accFor(match.home);
    const away = accFor(match.away);

    // A forfeit awards the full race to the winner without any games being
    // played: credit the win/loss (and games played) at the match level, but
    // add no balls — made or available — since there were no real games.
    if (match.forfeit) {
      const awarded = match.raceToGames;
      const winnerAcc = match.winner === match.home ? home : away;
      const loserAcc = match.winner === match.home ? away : home;
      winnerAcc.gamesPlayed += awarded;
      winnerAcc.gamesWon += awarded;
      loserAcc.gamesPlayed += awarded;
      loserAcc.gamesLost += awarded;
      continue;
    }

    for (const game of match.games) {
      const homeWon = game.winner === match.home;
      const awayWon = game.winner === match.away;
      if (!homeWon && !awayWon) {
        throw new Error(
          `Game ${game.id} winner "${game.winner}" is neither participant ` +
            `("${match.home}" / "${match.away}") of match ${match.id}`,
        );
      }

      home.gamesPlayed++;
      away.gamesPlayed++;
      home.ballsMade += game.ballsMade.home;
      away.ballsMade += game.ballsMade.away;
      home.ballsAvailable += game.target.home;
      away.ballsAvailable += game.target.away;

      if (homeWon) {
        home.gamesWon++;
        away.gamesLost++;
      } else {
        away.gamesWon++;
        home.gamesLost++;
      }
    }
  }

  const records = new Map<PlayerId, PlayerRecord>();
  for (const [id, a] of acc) {
    records.set(id, finalize(id, a));
  }
  return records;
}

function finalize(id: PlayerId, a: RecordAccumulator): PlayerRecord {
  const winPct = a.gamesPlayed > 0 ? a.gamesWon / a.gamesPlayed : 0;
  const ballPct = a.ballsAvailable > 0 ? a.ballsMade / a.ballsAvailable : 0;
  return {
    playerId: id,
    gamesPlayed: a.gamesPlayed,
    gamesWon: a.gamesWon,
    gamesLost: a.gamesLost,
    ballsMade: a.ballsMade,
    ballsAvailable: a.ballsAvailable,
    winPct,
    ballPct,
  };
}

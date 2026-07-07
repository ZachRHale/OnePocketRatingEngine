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
  /** Games won ÷ games played. `0` when the player has played nothing. */
  winPct: number;
  /**
   * How close this player's LOSSES were, in [0, 1]: the average of
   * `ballsMade / target` over the games they lost (1 = reached their target,
   * 0 = shut out). Special cases:
   *   - undefeated (played, never lost): `1` (ideal, ranks best on a tie);
   *   - never played: `0` (no basis, ranks worst on a tie).
   */
  lossCloseness: number;
}

/** Mutable accumulator used only while rolling up matches. */
interface RecordAccumulator {
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  ballsMade: number;
  lossClosenessSum: number;
}

function emptyAccumulator(): RecordAccumulator {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    ballsMade: 0,
    lossClosenessSum: 0,
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

      if (homeWon) {
        home.gamesWon++;
        away.gamesLost++;
        away.lossClosenessSum += closeness(game.ballsMade.away, game.target.away);
      } else {
        away.gamesWon++;
        home.gamesLost++;
        home.lossClosenessSum += closeness(game.ballsMade.home, game.target.home);
      }
    }
  }

  const records = new Map<PlayerId, PlayerRecord>();
  for (const [id, a] of acc) {
    records.set(id, finalize(id, a));
  }
  return records;
}

/** Fraction of the target a losing player reached, clamped to [0, 1]. */
function closeness(ballsMade: number, target: number): number {
  if (target <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, ballsMade / target));
}

function finalize(id: PlayerId, a: RecordAccumulator): PlayerRecord {
  const winPct = a.gamesPlayed > 0 ? a.gamesWon / a.gamesPlayed : 0;
  const lossCloseness =
    a.gamesLost > 0
      ? a.lossClosenessSum / a.gamesLost
      : a.gamesPlayed > 0
        ? 1 // undefeated: never fell short
        : 0; // never played
  return {
    playerId: id,
    gamesPlayed: a.gamesPlayed,
    gamesWon: a.gamesWon,
    gamesLost: a.gamesLost,
    ballsMade: a.ballsMade,
    winPct,
    lossCloseness,
  };
}

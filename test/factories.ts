import {
  seedPlayer,
  type BallSpot,
  type Game,
  type Match,
  type MatchId,
  type Player,
  type PlayerId,
} from "../src/index.js";

const EVEN_SPOT: BallSpot = { home: 8, away: 8 };

export function player(id: string, fargo = 500, name = id): Player {
  return seedPlayer(id, name, fargo);
}

/**
 * Compact spec for a single game. The winner, by definition, reached their
 * target ball count, so their ball total is implied by the match's ball spot.
 * The only free variable is how many balls the LOSER made — that is what
 * carries the margin of victory (0 = shutout, target-1 = hill-hill).
 */
export interface GameResult {
  winner: PlayerId;
  loserBalls: number;
}

/** A game the given player won; `loserBalls` defaults to 0 (a shutout). */
export function win(winner: PlayerId, loserBalls = 0): GameResult {
  return { winner, loserBalls };
}

/** `count` games won by `winner`, each with the same `loserBalls` margin. */
export function wins(
  winner: PlayerId,
  count: number,
  loserBalls = 0,
): GameResult[] {
  return Array.from({ length: count }, () => win(winner, loserBalls));
}

/**
 * Builds a Match from an ordered list of {@link GameResult}s. The winner's ball
 * total for each game is set to their target (they had to reach it to win); the
 * loser's is taken from `loserBalls`. `winner` and `score` are derived.
 */
export function match(opts: {
  id: MatchId;
  home: PlayerId;
  away: PlayerId;
  games: GameResult[];
  ballSpot?: BallSpot;
  week?: number;
}): Match {
  const ballSpot = opts.ballSpot ?? EVEN_SPOT;
  const games: Game[] = opts.games.map((result, i) => {
    const homeWon = result.winner === opts.home;
    const ballsMade = homeWon
      ? { home: ballSpot.home, away: result.loserBalls }
      : { home: result.loserBalls, away: ballSpot.away };
    return {
      id: `${opts.id}-g${i + 1}`,
      matchId: opts.id,
      gameNumber: i + 1,
      target: ballSpot,
      ballsMade,
      winner: result.winner,
    };
  });
  const homeWins = games.filter((g) => g.winner === opts.home).length;
  const awayWins = games.length - homeWins;
  return {
    id: opts.id,
    date: new Date("2026-01-01T00:00:00Z"),
    week: opts.week ?? 1,
    home: opts.home,
    away: opts.away,
    ballSpot,
    winner: homeWins > awayWins ? opts.home : opts.away,
    score: { home: homeWins, away: awayWins },
    raceToGames: 3,
    games,
  };
}

import {
  RACE_TO_GAMES,
  seedPlayer,
  type Game,
  type Match,
  type MatchId,
  type Player,
  type PlayerId,
  type Session,
  type SessionId,
} from "../domain/index.js";
import { SimpleProvisionalRatingEngine } from "../rating/index.js";
import type { RatingEngine } from "../rating/index.js";
import {
  DEFAULT_HANDICAP_TABLE,
  ballSpotForRatings,
  frozenRatingsForSession,
  normalizeHandicapTable,
  type HandicapTier,
} from "../league/index.js";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A loaded league: roster, full match history, and the sessions the matches
 * belong to — ready to hand straight to a {@link RatingEngine} and a
 * `LeagueService`.
 */
export interface LeagueData {
  players: Player[];
  matches: Match[];
  sessions: Session[];
}

/** One game's reported result, before ball spots are known. */
export interface GameResultInput {
  winner: PlayerId;
  /**
   * Balls the LOSER pocketed (0 = shutout). The winner, by definition, reached
   * their target, so their ball total is implied by the match's ball spot.
   */
  loserBalls: number;
}

/** One match's worth of results to append to the log. */
export interface NewMatch {
  sessionId: SessionId;
  /** Week WITHIN the session (1-based). */
  week: number;
  home: PlayerId;
  away: PlayerId;
  games: GameResultInput[];
  /** Optional explicit id; the store generates a unique one when omitted. */
  matchId?: MatchId;
}

/** A brand-new player to add to the roster. */
export interface NewPlayer {
  id: PlayerId;
  name: string;
  fargo: number;
}

/**
 * The persistence seam. The league is stored as an append-only game log; the
 * store loads it into domain objects and appends new results. Nothing above this
 * interface knows CSV, a file path, or a database — swap {@link CsvLeagueStore}
 * for a SQLite-backed one later and the rating engine, league logic, and UI do
 * not change.
 */
export interface LeagueRepository {
  /** Read the full league state from storage. */
  load(): LeagueData;
  /** Append one completed match's games to the log. Returns its id. */
  appendMatch(match: NewMatch): MatchId;
  /** Add a new player to the roster. */
  addPlayer(player: NewPlayer): void;
}

const PLAYERS_FILE = "players.csv";
const GAMES_FILE = "games.csv";
const PLAYERS_HEADER = "id,fargo,name";
const GAMES_HEADER = "session,matchId,week,home,away,winner,loserBalls";

/** Fixed, deterministic date: dates are not persisted and the engine ignores them. */
const MATCH_DATE = new Date("2026-01-01T00:00:00Z");

export interface CsvLeagueStoreOptions {
  /** Rating engine used to derive each session's frozen ball spots. */
  engine?: RatingEngine;
  /** Ball-spot ladder. Defaults to {@link DEFAULT_HANDICAP_TABLE}. */
  handicapTable?: readonly HandicapTier[];
}

/**
 * A CSV-backed {@link LeagueRepository}. Reads a directory holding two files:
 *
 *   players.csv  →  id, fargo, name
 *   games.csv    →  session, matchId, week, home, away, winner, loserBalls
 *                   (one row per game; `week` is 1-based WITHIN the session)
 *
 * Sessions are ordered by first appearance in games.csv (index 1, 2, …). Ball
 * spots are NOT stored — they are derived per league policy: each session's
 * spots come from the players' ratings **frozen at the start of that session**
 * (the engine folded over every earlier session). The first session uses Fargo
 * seeds; later sessions reflect prior play.
 *
 * Reads and appends are dependency-free (no CSV library): comma-separated, no
 * quoting or escaping, so fields — player names included — must not contain
 * commas or newlines. That is plenty for a small league and keeps the store
 * trivially inspectable in a spreadsheet.
 */
export class CsvLeagueStore implements LeagueRepository {
  private readonly dir: string;
  private readonly engine: RatingEngine;
  private readonly handicapTable: HandicapTier[];

  constructor(dir: string, options: CsvLeagueStoreOptions = {}) {
    this.dir = dir;
    this.engine = options.engine ?? new SimpleProvisionalRatingEngine();
    this.handicapTable = normalizeHandicapTable(
      options.handicapTable ?? DEFAULT_HANDICAP_TABLE,
    );
  }

  load(): LeagueData {
    const players = this.loadPlayers();
    const known = new Set(players.map((p) => p.id));

    const drafts = this.loadDrafts(known);
    const sessions = buildSessions(drafts);
    const matches = this.assembleMatches(players, sessions, drafts);

    return { players, matches, sessions };
  }

  appendMatch(match: NewMatch): MatchId {
    if (match.home === match.away) {
      throw new Error(`A player cannot play themselves: "${match.home}"`);
    }
    if (match.games.length === 0) {
      throw new Error("A match must have at least one game");
    }

    const players = this.loadPlayers();
    const known = new Set(players.map((p) => p.id));
    for (const id of [match.home, match.away]) {
      if (!known.has(id)) {
        throw new Error(`Unknown player "${id}"`);
      }
    }
    for (const [i, g] of match.games.entries()) {
      if (g.winner !== match.home && g.winner !== match.away) {
        throw new Error(
          `Game ${i + 1} winner "${g.winner}" is not in this match ` +
            `(${match.home} vs ${match.away})`,
        );
      }
      if (!Number.isFinite(g.loserBalls) || g.loserBalls < 0) {
        throw new Error(`Game ${i + 1} loserBalls must be >= 0`);
      }
    }

    const matchId =
      match.matchId ?? this.nextMatchId(match.sessionId, match.week);

    const rows = match.games.map((g) =>
      [
        match.sessionId,
        matchId,
        match.week,
        match.home,
        match.away,
        g.winner,
        g.loserBalls,
      ].join(","),
    );
    this.appendLines(GAMES_FILE, GAMES_HEADER, rows);
    return matchId;
  }

  addPlayer(player: NewPlayer): void {
    const existing = this.loadPlayers();
    if (existing.some((p) => p.id === player.id)) {
      throw new Error(`Player id "${player.id}" already exists`);
    }
    if (!Number.isFinite(player.fargo)) {
      throw new Error(`fargo for "${player.id}" must be a number`);
    }
    const row = [player.id, player.fargo, player.name].join(",");
    this.appendLines(PLAYERS_FILE, PLAYERS_HEADER, [row]);
  }

  // --- internals -----------------------------------------------------------

  private path(file: string): string {
    return join(this.dir, file);
  }

  private loadPlayers(): Player[] {
    const path = this.path(PLAYERS_FILE);
    if (!existsSync(path)) {
      throw new Error(`Missing ${PLAYERS_FILE} in "${this.dir}"`);
    }
    const rows = parseCsv(readFileSync(path, "utf8"));
    requireColumns(rows, ["id", "fargo", "name"], PLAYERS_FILE);

    const players: Player[] = [];
    const known = new Set<string>();
    for (const row of rows) {
      const id = row.id!;
      if (known.has(id)) {
        throw new Error(`Duplicate player id "${id}" in ${PLAYERS_FILE}`);
      }
      known.add(id);
      players.push(seedPlayer(id, row.name!, parseNumber(row.fargo!, `fargo for "${id}"`)));
    }
    return players;
  }

  /** Group game rows into per-match drafts, preserving file order. */
  private loadDrafts(known: Set<string>): MatchDraft[] {
    const path = this.path(GAMES_FILE);
    if (!existsSync(path)) {
      return [];
    }
    const rows = parseCsv(readFileSync(path, "utf8"));
    requireColumns(
      rows,
      ["session", "matchId", "week", "home", "away", "winner", "loserBalls"],
      GAMES_FILE,
    );

    const byId = new Map<string, MatchDraft>();
    const order: string[] = [];

    const requirePlayer = (id: string, where: string): void => {
      if (!known.has(id)) {
        throw new Error(`Unknown player "${id}" in ${GAMES_FILE} (${where})`);
      }
    };

    for (const row of rows) {
      const id = row.matchId!;
      const sessionId = row.session!;
      const week = parseNumber(row.week!, `week for match "${id}"`);
      const home = row.home!;
      const away = row.away!;
      const winner = row.winner!;
      const loserBalls = parseNumber(row.loserBalls!, `loserBalls for "${id}"`);

      requirePlayer(home, `match ${id} home`);
      requirePlayer(away, `match ${id} away`);
      if (home === away) {
        throw new Error(`Match "${id}" has the same player on both sides`);
      }
      if (winner !== home && winner !== away) {
        throw new Error(
          `Winner "${winner}" is not in match "${id}" (${home} vs ${away})`,
        );
      }

      let draft = byId.get(id);
      if (!draft) {
        draft = { id, sessionId, week, home, away, games: [] };
        byId.set(id, draft);
        order.push(id);
      } else if (
        draft.sessionId !== sessionId ||
        draft.home !== home ||
        draft.away !== away ||
        draft.week !== week
      ) {
        throw new Error(
          `Match "${id}" has inconsistent session/home/away/week across its rows`,
        );
      }
      draft.games.push({ winner, loserBalls });
    }

    return order.map((id) => byId.get(id)!);
  }

  /**
   * Forward pass: build each session's matches with the ball spots frozen at
   * that session's start (the engine folded over all earlier sessions only).
   */
  private assembleMatches(
    players: readonly Player[],
    sessions: readonly Session[],
    drafts: readonly MatchDraft[],
  ): Match[] {
    const matches: Match[] = [];
    for (const session of sessions) {
      const frozen = frozenRatingsForSession(
        this.engine,
        players,
        matches, // only earlier sessions have been pushed so far
        sessions,
        session.id,
      );
      const ratingById = new Map(frozen.map((r) => [r.playerId, r.leagueRating]));

      for (const d of drafts.filter((x) => x.sessionId === session.id)) {
        const ballSpot = ballSpotForRatings(
          this.handicapTable,
          ratingById.get(d.home)!,
          ratingById.get(d.away)!,
        );
        matches.push(buildMatch(d, ballSpot));
      }
    }
    return matches;
  }

  /** Next unique match id for a session+week, e.g. "summer-2026-w3-2". */
  private nextMatchId(sessionId: SessionId, week: number): MatchId {
    const known = new Set(this.loadPlayers().map((p) => p.id));
    const count = this.loadDrafts(known).filter(
      (d) => d.sessionId === sessionId && d.week === week,
    ).length;
    return `${sessionId}-w${week}-${count + 1}`;
  }

  private appendLines(file: string, header: string, lines: string[]): void {
    const path = this.path(file);
    if (!existsSync(path)) {
      writeFileSync(path, `${header}\n${lines.join("\n")}\n`, "utf8");
      return;
    }
    const current = readFileSync(path, "utf8");
    const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
    appendFileSync(path, `${prefix}${lines.join("\n")}\n`, "utf8");
  }
}

/** One match's worth of games, collected before ball spots are known. */
interface MatchDraft {
  id: string;
  sessionId: string;
  week: number;
  home: string;
  away: string;
  games: GameResultInput[];
}

/**
 * Session metadata derived from the grouped drafts: order and index by first
 * appearance, roster from the players seen, length from the highest week.
 */
function buildSessions(drafts: readonly MatchDraft[]): Session[] {
  const order: string[] = [];
  for (const d of drafts) {
    if (!order.includes(d.sessionId)) order.push(d.sessionId);
  }
  return order.map((id, i) => {
    const own = drafts.filter((d) => d.sessionId === id);
    const roster = [...new Set(own.flatMap((d) => [d.home, d.away]))];
    const weeks = own.reduce((max, d) => Math.max(max, d.week), 0);
    return { id, label: id, index: i + 1, weeks, playerIds: roster };
  });
}

/**
 * Builds a Match from a draft and its ball spot. The winner's ball total for
 * each game is their target (they had to reach it to win); the loser's is the
 * reported `loserBalls`. `winner` and `score` are derived.
 */
function buildMatch(draft: MatchDraft, ballSpot: { home: number; away: number }): Match {
  const games: Game[] = draft.games.map((result, i) => {
    const homeWon = result.winner === draft.home;
    const ballsMade = homeWon
      ? { home: ballSpot.home, away: result.loserBalls }
      : { home: result.loserBalls, away: ballSpot.away };
    return {
      id: `${draft.id}-g${i + 1}`,
      matchId: draft.id,
      gameNumber: i + 1,
      target: ballSpot,
      ballsMade,
      winner: result.winner,
    };
  });
  const homeWins = games.filter((g) => g.winner === draft.home).length;
  const awayWins = games.length - homeWins;
  return {
    id: draft.id,
    date: MATCH_DATE,
    sessionId: draft.sessionId,
    week: draft.week,
    home: draft.home,
    away: draft.away,
    ballSpot,
    winner: homeWins > awayWins ? draft.home : draft.away,
    score: { home: homeWins, away: awayWins },
    raceToGames: RACE_TO_GAMES,
    games,
  };
}

/**
 * Parses a minimal CSV: comma-separated, first row is the header, surrounding
 * whitespace trimmed, blank lines ignored. No quoting or escaping.
 */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const header = lines[0]!.split(",").map((h) => h.trim());
  return lines.slice(1).map((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length !== header.length) {
      throw new Error(
        `CSV row ${i + 2} has ${cells.length} columns, expected ${header.length}`,
      );
    }
    return Object.fromEntries(header.map((h, c) => [h, cells[c]!]));
  });
}

function requireColumns(
  rows: Record<string, string>[],
  columns: string[],
  file: string,
): void {
  if (rows.length === 0) return;
  const present = new Set(Object.keys(rows[0]!));
  const missing = columns.filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(`${file} is missing column(s): ${missing.join(", ")}`);
  }
}

function parseNumber(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a number, got "${value}"`);
  }
  return n;
}

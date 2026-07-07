import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ballSpotForRatings,
  DEFAULT_HANDICAP_TABLE,
  frozenRatingsForSession,
  SimpleProvisionalRatingEngine,
  type Match,
  type Player,
  type Session,
} from "../../src/index.js";
import { match, type GameResult, player } from "../factories.js";

/**
 * A loaded scenario: roster, matches, and the sessions they belong to — ready
 * to hand straight to a rating engine and a `LeagueService`.
 */
export interface Scenario {
  players: Player[];
  matches: Match[];
  sessions: Session[];
}

/**
 * Parses a minimal CSV: comma-separated, first row is the header, surrounding
 * whitespace trimmed, blank lines ignored. There is no quoting or escaping —
 * fields (player names included) must not contain commas or newlines. That is
 * plenty for scenario fixtures and keeps the loader dependency-free.
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

/** One match's worth of games, collected before ball spots are known. */
interface MatchDraft {
  id: string;
  sessionId: string;
  week: number;
  home: string;
  away: string;
  games: GameResult[];
}

/**
 * Loads a scenario from a directory containing two CSV files:
 *
 *   players.csv  →  id, fargo, name
 *   games.csv    →  session, matchId, week, home, away, winner, loserBalls
 *                   (one row per game; `week` is 1-based WITHIN the session)
 *
 * Sessions are ordered by first appearance in games.csv (index 1, 2, …). Ball
 * spots are NOT read from the file — they are derived per the league policy:
 * each session's spots come from the players' ratings **frozen at the start of
 * that session** (the engine folded over every earlier session). The first
 * session therefore uses Fargo seeds; later sessions reflect prior play.
 *
 * Everything is validated up front (unknown players, self-matches, a winner who
 * isn't in the match, inconsistent home/away/week/session across a match's rows)
 * and fails loudly, because a silent typo would quietly corrupt the scenario.
 */
export function loadScenario(dir: string): Scenario {
  const playerRows = parseCsv(readFileSync(join(dir, "players.csv"), "utf8"));
  requireColumns(playerRows, ["id", "fargo", "name"], "players.csv");

  const players: Player[] = [];
  const known = new Set<string>();
  for (const row of playerRows) {
    const id = row.id!;
    if (known.has(id)) {
      throw new Error(`Duplicate player id "${id}" in players.csv`);
    }
    known.add(id);
    players.push(player(id, parseNumber(row.fargo!, `fargo for "${id}"`), row.name!));
  }

  const gameRows = parseCsv(readFileSync(join(dir, "games.csv"), "utf8"));
  requireColumns(
    gameRows,
    ["session", "matchId", "week", "home", "away", "winner", "loserBalls"],
    "games.csv",
  );

  // Group game rows into match drafts, preserving file order for both the
  // sessions and the matches within them.
  const drafts = new Map<string, MatchDraft>();
  const matchOrder: string[] = [];
  const sessionOrder: string[] = [];

  const requirePlayer = (id: string, where: string): void => {
    if (!known.has(id)) {
      throw new Error(`Unknown player "${id}" in games.csv (${where})`);
    }
  };

  for (const row of gameRows) {
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

    let draft = drafts.get(id);
    if (!draft) {
      draft = { id, sessionId, week, home, away, games: [] };
      drafts.set(id, draft);
      matchOrder.push(id);
      if (!sessionOrder.includes(sessionId)) sessionOrder.push(sessionId);
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

  // Build Session metadata (roster + length) from the grouped drafts.
  const draftsInOrder = matchOrder.map((id) => drafts.get(id)!);
  const sessions: Session[] = sessionOrder.map((id, i) => {
    const own = draftsInOrder.filter((d) => d.sessionId === id);
    const roster = [...new Set(own.flatMap((d) => [d.home, d.away]))];
    const weeks = own.reduce((max, d) => Math.max(max, d.week), 0);
    return { id, label: id, index: i + 1, weeks, playerIds: roster };
  });

  // Forward pass: process sessions in order. Each session's ball spots come from
  // ratings frozen at its start (the engine folded over all earlier sessions).
  const engine = new SimpleProvisionalRatingEngine();
  const table = DEFAULT_HANDICAP_TABLE;
  const matches: Match[] = [];

  for (const session of sessions) {
    const frozen = frozenRatingsForSession(
      engine,
      players,
      matches, // only earlier sessions have been pushed so far
      sessions,
      session.id,
    );
    const ratingById = new Map(frozen.map((r) => [r.playerId, r.leagueRating]));

    for (const d of draftsInOrder.filter((x) => x.sessionId === session.id)) {
      matches.push(
        match({
          id: d.id,
          home: d.home,
          away: d.away,
          week: d.week,
          sessionId: d.sessionId,
          games: d.games,
          ballSpot: ballSpotForRatings(
            table,
            ratingById.get(d.home)!,
            ratingById.get(d.away)!,
          ),
        }),
      );
    }
  }

  return { players, matches, sessions };
}

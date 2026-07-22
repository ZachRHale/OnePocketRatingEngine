/**
 * A thin HTTP front end for the league — no framework, no build step.
 *
 * It is a *consumer* of the library, not part of it: it holds no league logic of
 * its own. Every request loads the current state through the `LeagueRepository`
 * (CSV today, a database later), asks the rating engine and `LeagueService` the
 * right question, and returns JSON. Writes append one match to the game log and
 * everything is recomputed from history on the next read.
 *
 * Run it with:  npm run serve   (uses vite-node, already in the toolchain)
 * Data dir:     $LEAGUE_DATA_DIR, else test/scenarios/data/season-2026
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CsvLeagueStore,
  DEFAULT_HANDICAP_TABLE,
  LeagueService,
  RACE_TO_GAMES,
  SimpleProvisionalRatingEngine,
  ballSpotForRatings,
  formatBallSpot,
  spotRatingsFor,
  type LeagueData,
  type PlayerRating,
  type SessionId,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env.LEAGUE_DATA_DIR ?? join(HERE, "data", "season-2026");
const PORT = Number(process.env.PORT ?? 8080);

const store = new CsvLeagueStore(DATA_DIR);
const engine = new SimpleProvisionalRatingEngine();
const handicapTable = DEFAULT_HANDICAP_TABLE;

/**
 * The league's planned sessions, in running order. These populate the UI
 * dropdown even before any games are recorded, so results can be entered for an
 * upcoming season. Edit this list to add or rename seasons; a session's `id` is
 * what gets written into games.csv, so keep it stable once it has games.
 */
const KNOWN_SESSIONS: { id: string; label: string; weeks: number }[] = [
  { id: "spring-2026", label: "Spring 2026", weeks: 12 },
  { id: "summer-2026", label: "Summer 2026", weeks: 12 },
  { id: "fall-2026", label: "Fall 2026", weeks: 12 },
  { id: "winter-2026", label: "Winter 2026", weeks: 12 },
];

/** One session as the UI needs it: the planned list, plus anything already in
 *  the data (e.g. legacy ids) appended so no recorded session is ever hidden. */
interface SessionView {
  id: string;
  label: string;
  index: number;
  weeks: number;
  players: string[];
  /** Whether any games have been recorded for this session yet. */
  hasGames: boolean;
}

function sessionViews(data: LeagueData): SessionView[] {
  const byId = new Map(data.sessions.map((s) => [s.id, s]));
  const views: SessionView[] = [];
  const seen = new Set<string>();
  for (const known of KNOWN_SESSIONS) {
    const d = byId.get(known.id);
    views.push({
      id: known.id,
      label: known.label,
      index: views.length + 1,
      weeks: d ? d.weeks : known.weeks,
      players: d ? d.playerIds : [],
      hasGames: d !== undefined,
    });
    seen.add(known.id);
  }
  for (const d of data.sessions) {
    if (seen.has(d.id)) continue;
    views.push({
      id: d.id,
      label: d.label,
      index: views.length + 1,
      weeks: d.weeks,
      players: d.playerIds,
      hasGames: true,
    });
  }
  return views;
}

/**
 * The ratings that govern tonight's ball spots. Each player's spot rating is
 * frozen at their most recent 20-game boundary and re-bases every 20 games
 * (see `spotRatingsFor`); it is independent of sessions. A player with fewer
 * than 20 games on record is still spotted from their Fargo seed.
 */
function spotRatings(data: LeagueData): PlayerRating[] {
  return spotRatingsFor(engine, data.players, data.matches);
}

/** Resolve the session to show: an explicit id, else the latest played, else
 *  the first planned session. */
function resolveSession(data: LeagueData, requested: string | null): SessionId {
  if (requested) return requested;
  const latest = [...data.sessions].sort((a, b) => b.index - a.index)[0];
  return latest?.id ?? KNOWN_SESSIONS[0]!.id;
}

function stateFor(sessionId: SessionId): unknown {
  const data = store.load();
  const activeSessionId = resolveSession(data, sessionId);

  // Two distinct rating clocks land in the standings:
  //   Live  — folded over every game to date. This is the number that moves and
  //           the one that decides provisional status, confidence and trend.
  //   Spot  — each player's rating frozen at their most recent 20-game boundary;
  //           it sets ball spots and re-bases every 20 games, not every game.
  const current = engine.calculateRatings({
    players: data.players,
    matches: data.matches,
  });
  const spotRatingById = new Map(
    spotRatings(data).map((r) => [r.playerId, r.leagueRating]),
  );

  const league = new LeagueService(data.players, current, data.matches, {
    handicapTable,
  });
  // Always session-scoped: a session with no games yet shows the full roster at
  // zero, which is the right "not started" view for an upcoming season.
  const standings = league.standings(activeSessionId).map((s) => ({
    ...s,
    // `leagueRating`, `provisional`, `confidence`, `trend` are already the
    // live values (the service was built from `current`). Attach the spot.
    spotRating: spotRatingById.get(s.playerId) ?? s.leagueRating,
  }));

  return {
    activeSessionId,
    raceToGames: RACE_TO_GAMES,
    players: data.players.map((p) => ({
      id: p.id,
      name: p.name,
      fargo: p.fargoRating,
    })),
    sessions: sessionViews(data),
    standings,
    allTimeStandings: league.standings(),
  };
}

/** Tonight's spot for a pairing, oriented to home/away. */
function ballSpot(home: string, away: string): unknown {
  const data = store.load();
  const ratingById = new Map(
    spotRatings(data).map((r) => [r.playerId, r.leagueRating]),
  );
  const hr = ratingById.get(home);
  const ar = ratingById.get(away);
  if (hr === undefined || ar === undefined) {
    throw new HttpError(400, `Unknown player in matchup ${home} vs ${away}`);
  }
  const spot = ballSpotForRatings(handicapTable, hr, ar);
  return {
    home,
    away,
    homeRating: hr,
    awayRating: ar,
    spot,
    formatted: formatBallSpot(spot),
  };
}

interface RecordMatchBody {
  sessionId?: string;
  week?: number;
  home?: string;
  away?: string;
  games?: { winner?: string; loserBalls?: number }[];
}

function recordMatch(body: RecordMatchBody): unknown {
  const { sessionId, week, home, away, games } = body;
  if (
    !sessionId ||
    !home ||
    !away ||
    !Array.isArray(games) ||
    games.length === 0
  ) {
    throw new HttpError(
      400,
      "sessionId, home, away and at least one game are required",
    );
  }
  if (!Number.isInteger(week) || (week as number) < 1) {
    throw new HttpError(400, "week must be a positive integer");
  }

  // Validate each game against the spot in effect right now before writing.
  const data = store.load();
  const ratingById = new Map(
    spotRatings(data).map((r) => [r.playerId, r.leagueRating]),
  );
  const hr = ratingById.get(home);
  const ar = ratingById.get(away);
  if (hr === undefined || ar === undefined) {
    throw new HttpError(400, `Unknown player in matchup ${home} vs ${away}`);
  }
  const spot = ballSpotForRatings(handicapTable, hr, ar);

  let homeWins = 0;
  let awayWins = 0;
  const cleaned = games.map((g, i) => {
    const winner = g.winner;
    if (winner !== home && winner !== away) {
      throw new HttpError(
        400,
        `Game ${i + 1}: winner must be ${home} or ${away}`,
      );
    }
    const loserTarget = winner === home ? spot.away : spot.home;
    const loserBalls = Number(g.loserBalls ?? 0);
    if (
      !Number.isInteger(loserBalls) ||
      loserBalls < 0 ||
      loserBalls >= loserTarget
    ) {
      throw new HttpError(
        400,
        `Game ${i + 1}: loser balls must be a whole number from 0 to ${loserTarget - 1}`,
      );
    }
    if (winner === home) homeWins++;
    else awayWins++;
    return { winner, loserBalls };
  });

  const winnerWins = Math.max(homeWins, awayWins);
  if (winnerWins !== RACE_TO_GAMES) {
    throw new HttpError(
      400,
      `A match is a race to ${RACE_TO_GAMES}; the winner must have exactly ${RACE_TO_GAMES} game wins (got ${homeWins}-${awayWins})`,
    );
  }

  const matchId = store.appendMatch({
    sessionId,
    week: week as number,
    home,
    away,
    games: cleaned,
  });
  return { matchId, ...(stateFor(sessionId) as object) };
}

// --- HTTP plumbing ---------------------------------------------------------

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readBody(
  req: import("node:http").IncomingMessage,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      const html = await readFile(join(HERE, "public", "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && path === "/api/state") {
      sendJson(
        res,
        200,
        stateFor(resolveSession(store.load(), url.searchParams.get("session"))),
      );
      return;
    }

    if (req.method === "GET" && path === "/api/ballspot") {
      const home = url.searchParams.get("home") ?? "";
      const away = url.searchParams.get("away") ?? "";
      if (!home || !away || home === away) {
        throw new HttpError(400, "home and away must be two different players");
      }
      sendJson(res, 200, ballSpot(home, away));
      return;
    }

    if (req.method === "POST" && path === "/api/matches") {
      const body = JSON.parse((await readBody(req)) || "{}") as RecordMatchBody;
      sendJson(res, 201, recordMatch(body));
      return;
    }

    throw new HttpError(404, `Not found: ${req.method} ${path}`);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    if (status === 500) console.error(err);
    sendJson(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`League app running at http://localhost:${PORT}`);
  console.log(`Reading/writing CSV in: ${DATA_DIR}`);
});

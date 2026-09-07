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
  SPOT_REFRESH_GAMES,
  SimpleProvisionalRatingEngine,
  ballSpotForRatings,
  buildSchedule,
  draftDivisions,
  fixturesFor,
  fixturesToWeeks,
  formatBallSpot,
  spotRatingsFor,
  type Fixture,
  type LeagueData,
  type PlayerRating,
  type SessionId,
  type Standing,
} from "../src/index.js";
import {
  regularSeasonFor,
  resolveSession,
  sessionViews,
  type SessionView,
} from "./sessions.js";
import {
  renderReportHtml,
  renderReportText,
  weeklyReportFor,
} from "./report.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env.LEAGUE_DATA_DIR ?? join(HERE, "data", "season-2026");
const PORT = Number(process.env.PORT ?? 8080);

const store = new CsvLeagueStore(DATA_DIR);
const engine = new SimpleProvisionalRatingEngine();
const handicapTable = DEFAULT_HANDICAP_TABLE;

/** How many players per division advance to the playoff bracket. */
const PLAYOFF_QUALIFIERS_PER_DIVISION = 2;

/**
 * The ratings that govern tonight's ball spots. Each player's spot rating is
 * frozen at their most recent 10-game boundary and re-bases every 10 games
 * (see `spotRatingsFor`); it is independent of sessions. A player with fewer
 * than 10 games on record is still spotted from their Fargo seed.
 */
function spotRatings(data: LeagueData): PlayerRating[] {
  return spotRatingsFor(engine, data.players, data.matches);
}

/**
 * Who has qualified for a playoff bracket: the top
 * {@link PLAYOFF_QUALIFIERS_PER_DIVISION} of each division in the regular
 * season, in division order. With two divisions that is a four-player bracket —
 * the two semifinals cross the divisions (A1 vs B2, B1 vs A2) so the two
 * division winners can only meet in the final.
 *
 * Seeds are read straight off the division standings, so they reflect the same
 * win% / ball% ranking as the table the players have been watching all season.
 *
 * Returns an empty list for a session that is not a playoff, or whose regular
 * season has no divisions, or whose regular season has not been played. That
 * last guard matters: with no games recorded every player is 0-0, so the
 * standings fall through to the name tiebreaker and the "bracket" would be four
 * players in alphabetical order — a confidently wrong answer, which is worse
 * than no answer.
 */
function playoffSeeds(
  league: LeagueService,
  views: readonly SessionView[],
  sessionId: SessionId,
): { seed: string; playerId: string; divisionId: string }[] {
  const regularId = regularSeasonFor(sessionId);
  if (regularId === null) return [];
  const regular = views.find((v) => v.id === regularId);
  if (!regular || regular.divisions.length === 0 || !regular.hasGames) return [];

  const seeds: { seed: string; playerId: string; divisionId: string }[] = [];
  for (const division of regular.divisions) {
    const table = league.standings(regularId, {
      playerIds: division.playerIds,
    });
    for (const row of table.slice(0, PLAYOFF_QUALIFIERS_PER_DIVISION)) {
      seeds.push({
        seed: `${division.id.toUpperCase()}${row.rank}`,
        playerId: row.playerId,
        divisionId: division.id,
      });
    }
  }
  return seeds;
}

function stateFor(sessionId: SessionId, divisionId: string | null): unknown {
  const data = store.load();
  const activeSessionId = resolveSession(data, sessionId);
  const views = sessionViews(data);
  const activeView = views.find((v) => v.id === activeSessionId);
  const divisions = activeView?.divisions ?? [];

  // Two distinct rating clocks land in the standings:
  //   Live  — folded over every game to date. This is the number that moves and
  //           the one that decides provisional status, confidence and trend.
  //   Spot  — each player's rating frozen at their most recent 10-game boundary;
  //           it sets ball spots and re-bases every 10 games, not every game.
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
  // `leagueRating`, `provisional`, `confidence`, `trend` are already the live
  // values (the service was built from `current`). Attach the spot.
  const withSpot = (rows: Standing[]) =>
    rows.map((s) => ({
      ...s,
      spotRating: spotRatingById.get(s.playerId) ?? s.leagueRating,
    }));

  const seeds = playoffSeeds(league, views, activeSessionId);

  // Always session-scoped, to everyone the session is *about*: whoever is on
  // record (from the game log, or from a division draft written before week 1)
  // plus, for a playoff, everyone who qualified. The union matters mid-bracket —
  // on record alone would drop the semifinal that has not been played yet, and
  // seeds alone would drop anyone who played without qualifying. A session with
  // neither shows the full league, the right "not started" view for an
  // undrafted season.
  const roster = [
    ...new Set([...(activeView?.players ?? []), ...seeds.map((q) => q.playerId)]),
  ];
  const scope = roster.length > 0 ? { playerIds: roster } : {};
  const standings = withSpot(league.standings(activeSessionId, scope));
  const divisionStandings = divisions.map((d) => ({
    id: d.id,
    label: d.label,
    standings: withSpot(league.standings(activeSessionId, { playerIds: d.playerIds })),
  }));

  // Echo the requested division only if it exists this session, so a stale
  // selection in the UI falls back to the combined table instead of an empty one.
  const activeDivisionId =
    divisionId && divisions.some((d) => d.id === divisionId)
      ? divisionId
      : null;

  return {
    activeSessionId,
    activeDivisionId,
    divisionStandings,
    playoffSeeds: seeds,
    raceToGames: RACE_TO_GAMES,
    players: data.players.map((p) => ({
      id: p.id,
      name: p.name,
      fargo: p.fargoRating,
    })),
    sessions: views,
    standings,
    allTimeStandings: withSpot(league.standings()),
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
  /** Division view to return in the response; purely presentational. */
  division?: string;
  week?: number;
  home?: string;
  away?: string;
  games?: { winner?: string; loserBalls?: number }[];
  /** When true, record a forfeit (no games) awarded to {@link forfeitWinner}. */
  forfeit?: boolean;
  forfeitWinner?: string;
}

function recordMatch(body: RecordMatchBody): unknown {
  if (body.forfeit) {
    return recordForfeit(body);
  }
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
    // Negatives are legal: in one pocket each foul costs a ball, so a loser
    // can finish below zero. Only the winner reaches their target, so the
    // loser must stay strictly below theirs.
    const loserBalls = Number(g.loserBalls ?? 0);
    if (!Number.isInteger(loserBalls) || loserBalls >= loserTarget) {
      throw new HttpError(
        400,
        `Game ${i + 1}: loser balls must be a whole number below ${loserTarget} (negatives allowed for fouls)`,
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
  return { matchId, ...(stateFor(sessionId, body.division ?? null) as object) };
}

/**
 * Record a forfeit: a win awarded to `forfeitWinner` with no games played. It
 * shows in the standings (a full race won/lost) but is invisible to ratings and
 * ball spots, so no spot lookup or per-game validation is needed here.
 */
function recordForfeit(body: RecordMatchBody): unknown {
  const { sessionId, week, home, away, forfeitWinner } = body;
  if (!sessionId || !home || !away) {
    throw new HttpError(400, "sessionId, home and away are required");
  }
  if (home === away) {
    throw new HttpError(400, "home and away must be two different players");
  }
  if (!Number.isInteger(week) || (week as number) < 1) {
    throw new HttpError(400, "week must be a positive integer");
  }
  if (forfeitWinner !== home && forfeitWinner !== away) {
    throw new HttpError(400, "forfeit winner must be the home or away player");
  }

  // Confirm both players are on the roster before writing.
  const data = store.load();
  const known = new Set(data.players.map((p) => p.id));
  if (!known.has(home) || !known.has(away)) {
    throw new HttpError(400, `Unknown player in matchup ${home} vs ${away}`);
  }

  const matchId = store.appendMatch({
    sessionId,
    week: week as number,
    home,
    away,
    games: [],
    forfeit: true,
    forfeitWinner,
  });
  return { matchId, ...(stateFor(sessionId, body.division ?? null) as object) };
}

/**
 * Propose a division split for a session. Divisions are re-drafted every
 * session, so this is the tool that makes that a one-click job: it returns a
 * balanced serpentine draft (see `draftDivisions`) over the current roster,
 * along with the exact divisions.csv rows to paste.
 *
 * It **writes nothing**. A division is a roster decision — availability, who
 * wants to play whom, who asked to move — and none of that is in the data. So
 * this proposes and the human commits, by pasting into divisions.csv.
 *
 * Players are rated by their spot rating, the same number that sets their ball
 * spots: it holds at the Fargo seed until a player's first 10 games, so a
 * brand-new league drafts on Fargo and a running one drafts on league results.
 */
function draftProposal(sessionId: SessionId, divisionCount: number): unknown {
  if (!Number.isInteger(divisionCount) || divisionCount < 1) {
    throw new HttpError(400, "divisions must be a positive integer");
  }
  const data = store.load();
  if (data.players.length < divisionCount) {
    throw new HttpError(
      400,
      `Cannot draft ${divisionCount} divisions from ${data.players.length} player(s)`,
    );
  }
  const ratingById = new Map(
    spotRatings(data).map((r) => [r.playerId, r.leagueRating]),
  );
  const nameById = new Map(data.players.map((p) => [p.id, p.name]));

  const divisions = draftDivisions(
    data.players.map((p) => ({
      playerId: p.id,
      rating: ratingById.get(p.id) ?? p.fargoRating,
    })),
    divisionCount,
  );

  const rows = divisions.flatMap((d) =>
    d.playerIds.map((id) => `${sessionId},${d.id},${id}`),
  );

  return {
    sessionId,
    divisionCount,
    divisions: divisions.map((d) => {
      const ratings = d.playerIds.map((id) => ratingById.get(id) ?? 0);
      const total = ratings.reduce((sum, r) => sum + r, 0);
      return {
        id: d.id,
        label: d.label,
        average: d.playerIds.length > 0 ? total / d.playerIds.length : 0,
        players: d.playerIds.map((id) => ({
          id,
          name: nameById.get(id) ?? id,
          rating: ratingById.get(id) ?? 0,
        })),
      };
    }),
    /**
     * Paste-ready divisions.csv body (no header), newline-terminated. The
     * trailing newline matters: these rows are meant to be appended to an
     * existing divisions.csv, and without it a second append would run the
     * last row of this batch into the first row of the next.
     */
    csv: rows.length > 0 ? rows.join("\n") + "\n" : "",
  };
}

/**
 * The schedule for a session, division by division, as the UI and a printout
 * need it: weeks in order, each fixture annotated with whether it has been
 * played and what the ball spot would be.
 *
 * Two honest caveats are baked into the response rather than left implicit:
 *
 *   - `spot` is **as of right now**, not a promise. Spot ratings re-base every
 *     10 games a player finishes (see `spotRatingsFor`), so the spot shown on a
 *     week-9 fixture will very likely move before it is played. `spotSettled`
 *     marks the fixtures that are actually safe to print.
 *   - `played` is matched on session, week and the unordered pair, so seats can
 *     be swapped on the night without breaking the link. A fixture played in a
 *     different week reads as unplayed, which is the truthful answer: the
 *     schedule says one thing and the game log says another.
 */
function scheduleFor(sessionId: SessionId, divisionId: string | null): unknown {
  const data = store.load();
  const views = sessionViews(data);
  const view = views.find((v) => v.id === sessionId);
  const nameById = new Map(data.players.map((p) => [p.id, p.name]));

  const ratings = spotRatings(data);
  const ratingById = new Map(ratings.map((r) => [r.playerId, r.leagueRating]));
  // Games each player still owes before their spot re-bases. A fixture's spot
  // is only settled if neither player can cross a boundary before playing it.
  const owed = new Map(
    ratings.map((r) => [
      r.playerId,
      SPOT_REFRESH_GAMES - (r.gamesPlayed % SPOT_REFRESH_GAMES),
    ]),
  );

  // Which (week, unordered pair) combinations already have a result.
  const pairKey = (week: number, a: string, b: string) =>
    week + "|" + [a, b].sort().join("|");
  const playedKeys = new Set(
    data.matches
      .filter((m) => m.sessionId === sessionId)
      .map((m) => pairKey(m.week, m.home, m.away)),
  );

  const fixtures = data.schedule.filter((f) => f.sessionId === sessionId);

  // Group by division so each division's byes come from its own roster. An
  // undivided session is one unnamed group over the whole session roster.
  const groups: { id: string | null; label: string; roster: string[] }[] =
    view && view.divisions.length > 0
      ? view.divisions.map((d) => ({
          id: d.id,
          label: d.label,
          roster: d.playerIds,
        }))
      : [{ id: null, label: "All players", roster: view?.players ?? [] }];

  const selected = divisionId
    ? groups.filter((g) => g.id === divisionId)
    : groups;

  const divisions = selected.map((group) => {
    const inGroup = new Set(group.roster);
    const own =
      group.id === null
        ? fixtures
        : fixtures.filter((f) => inGroup.has(f.home) && inGroup.has(f.away));

    const weeks = fixturesToWeeks(own, group.roster).map((week) => ({
      week: week.week,
      byes: week.byes.map((id) => ({ id, name: nameById.get(id) ?? id })),
      matches: week.matches.map((m) => {
        const hr = ratingById.get(m.home);
        const ar = ratingById.get(m.away);
        const spot =
          hr === undefined || ar === undefined
            ? null
            : ballSpotForRatings(handicapTable, hr, ar);
        // Only week 1 can be printed with confidence: any later week sits
        // behind games that may re-base either player's spot first.
        const settled =
          week.week === 1 &&
          (owed.get(m.home) ?? 0) > 0 &&
          (owed.get(m.away) ?? 0) > 0;
        return {
          home: m.home,
          homeName: nameById.get(m.home) ?? m.home,
          away: m.away,
          awayName: nameById.get(m.away) ?? m.away,
          spot,
          formatted: spot ? formatBallSpot(spot) : null,
          spotSettled: settled,
          played: playedKeys.has(pairKey(week.week, m.home, m.away)),
        };
      }),
    }));

    const all = weeks.flatMap((w) => w.matches);
    return {
      id: group.id,
      label: group.label,
      weeks,
      fixtureCount: own.length,
      playedCount: all.filter((m) => m.played).length,
    };
  });

  // Fixtures belonging to no division — a hand edit pairing across divisions.
  // Surfaced rather than dropped, so an accident is visible instead of
  // silently vanishing from every table.
  const grouped = new Set(
    divisions.flatMap((d) =>
      d.weeks.flatMap((w) =>
        w.matches.map((m) => w.week + "|" + m.home + "|" + m.away),
      ),
    ),
  );
  const ungrouped = fixtures
    .filter((f) => !grouped.has(f.week + "|" + f.home + "|" + f.away))
    .map((f) => ({
      week: f.week,
      home: f.home,
      homeName: nameById.get(f.home) ?? f.home,
      away: f.away,
      awayName: nameById.get(f.away) ?? f.away,
    }));

  return {
    sessionId,
    label: view?.label ?? sessionId,
    plannedWeeks: view?.weeks ?? 0,
    divisions,
    ungrouped,
    total: fixtures.length,
  };
}

interface GenerateScheduleBody {
  sessionId?: string;
  /** Weeks to generate. Defaults to the session's planned length. */
  weeks?: number;
  /** Required to overwrite a session that already has fixtures. */
  replace?: boolean;
}

/**
 * Generate a session's fixtures and write them to schedule.csv — one
 * round-robin per division, every division running the same weeks in parallel.
 *
 * It **refuses to overwrite** an existing schedule unless `replace` is set, and
 * that guard is the whole reason the schedule is worth persisting: once the file
 * exists it has probably been hand-edited, and regenerating silently would throw
 * those edits away. Generate once, then edit the file — or skip this entirely
 * and write the file yourself.
 *
 * The rotation offset is the session's index, so the byes and rematches a
 * partial cycle hands to some players land on *different* players next session
 * (see `buildSchedule`).
 */
function generateSchedule(body: GenerateScheduleBody): unknown {
  const { sessionId } = body;
  if (!sessionId) {
    throw new HttpError(400, "sessionId is required");
  }
  const data = store.load();
  const views = sessionViews(data);
  const view = views.find((v) => v.id === sessionId);
  if (!view) {
    throw new HttpError(400, 'Unknown session "' + sessionId + '"');
  }

  const existing = data.schedule.filter((f) => f.sessionId === sessionId);
  if (existing.length > 0 && body.replace !== true) {
    throw new HttpError(
      409,
      'Session "' +
        sessionId +
        '" already has ' +
        existing.length +
        " scheduled fixture(s). Pass replace: true to discard them and " +
        "regenerate — any hand edits in schedule.csv for this session " +
        "will be lost.",
    );
  }

  const weeks = body.weeks ?? view.weeks;
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new HttpError(400, "weeks must be a positive integer");
  }

  // One round-robin per division; an undivided session schedules its whole
  // roster as a single group.
  const groups =
    view.divisions.length > 0
      ? view.divisions.map((d) => d.playerIds)
      : [view.players];

  const fixtures: Fixture[] = [];
  for (const roster of groups) {
    if (roster.length < 2) {
      throw new HttpError(
        400,
        "Cannot schedule a group of " +
          roster.length +
          ' player(s) in "' +
          sessionId +
          '" — draft the divisions first (see /api/draft).',
      );
    }
    fixtures.push(
      ...fixturesFor(
        sessionId,
        buildSchedule(roster, weeks, { rotation: view.index }),
      ),
    );
  }

  const written = store.replaceSchedule(sessionId, fixtures);
  return {
    written,
    replaced: existing.length,
    ...(scheduleFor(sessionId, null) as object),
  };
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

    // The weekly email, rendered. Open it, select all, paste into the mail
    // client — the report's styles are inlined so they survive the paste.
    if (req.method === "GET" && path === "/report") {
      const weekParam = url.searchParams.get("week");
      const week = weekParam === null ? null : Number(weekParam);
      if (week !== null && (!Number.isInteger(week) || week < 1)) {
        throw new HttpError(400, "week must be a positive integer");
      }
      const report = weeklyReportFor(store, {
        session: url.searchParams.get("session"),
        week,
      });
      const text = url.searchParams.get("format") === "text";
      res.writeHead(200, {
        "content-type": text
          ? "text/plain; charset=utf-8"
          : "text/html; charset=utf-8",
      });
      res.end(text ? renderReportText(report) : renderReportHtml(report));
      return;
    }

    if (req.method === "GET" && path === "/api/state") {
      sendJson(
        res,
        200,
        stateFor(
          resolveSession(store.load(), url.searchParams.get("session")),
          url.searchParams.get("division"),
        ),
      );
      return;
    }

    if (req.method === "GET" && path === "/api/schedule") {
      sendJson(
        res,
        200,
        scheduleFor(
          resolveSession(store.load(), url.searchParams.get("session")),
          url.searchParams.get("division"),
        ),
      );
      return;
    }

    if (req.method === "POST" && path === "/api/schedule") {
      const body = JSON.parse(
        (await readBody(req)) || "{}",
      ) as GenerateScheduleBody;
      sendJson(res, 201, generateSchedule(body));
      return;
    }

    if (req.method === "GET" && path === "/api/draft") {
      const requested = url.searchParams.get("divisions");
      sendJson(
        res,
        200,
        draftProposal(
          resolveSession(store.load(), url.searchParams.get("session")),
          requested === null ? 2 : Number(requested),
        ),
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

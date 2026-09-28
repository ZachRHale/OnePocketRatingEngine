import {
  RACE_TO_GAMES,
  seedPlayer,
  type BallSpot,
  type Game,
  type Match,
  type MatchId,
  type Player,
  type PlayerId,
  type Division,
  type Session,
  type SessionId,
} from "../domain/index.js";
import { SimpleProvisionalRatingEngine } from "../rating/index.js";
import type { RatingEngine } from "../rating/index.js";
import {
  DEFAULT_HANDICAP_TABLE,
  ballSpotForRatings,
  normalizeHandicapTable,
  spotRatingsFor,
  type Fixture,
  type HandicapTier,
} from "../league/index.js";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
  /**
   * Planned fixtures across every session, in file order. A *plan*, not a
   * result: nothing here affects ratings, spots, or standings, and a fixture
   * that never gets played simply stays unplayed.
   */
  schedule: Fixture[];
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
  /** The games played. Empty (and ignored) for a {@link forfeit}. */
  games: GameResultInput[];
  /**
   * A forfeit: the match is awarded to {@link forfeitWinner} without any games.
   * When set, `games` is ignored and no result affects ratings or ball spots.
   */
  forfeit?: boolean;
  /** Required when {@link forfeit}: the player awarded the win (must be home or away). */
  forfeitWinner?: PlayerId;
  /**
   * A spot the players agreed to instead of the rating-derived one, oriented to
   * this match's home/away. Stored with the games so the log records the spot
   * they were actually played under; omit it to let the ratings set the spot.
   * Not allowed on a {@link forfeit}, which has no games to spot.
   */
  agreedSpot?: BallSpot;
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
  /**
   * Replace one session's planned fixtures, leaving every other session's
   * alone. Returns the number of fixtures written.
   *
   * This is the one write in the store that is NOT append-only, and the
   * asymmetry is the point: {@link appendMatch} records facts, which are never
   * rewritten, while a schedule is a plan and plans get redrawn. Scoping the
   * replacement to a single session means regenerating one session cannot
   * disturb another's hand edits.
   */
  replaceSchedule(sessionId: SessionId, fixtures: readonly Fixture[]): number;
}

const PLAYERS_FILE = "players.csv";
const GAMES_FILE = "games.csv";
const DIVISIONS_FILE = "divisions.csv";
const SCHEDULE_FILE = "schedule.csv";
const PLAYERS_HEADER = "id,fargo,name";
const GAMES_HEADER =
  "session,matchId,week,home,away,winner,loserBalls,forfeit,spotHome,spotAway";
/**
 * Trailing games.csv columns added after the log format was first written, in
 * header order, with the value that upgrades an existing row.
 */
const GAMES_OPTIONAL_COLUMNS: readonly [column: string, fill: string][] = [
  ["forfeit", "0"],
  ["spotHome", ""],
  ["spotAway", ""],
];
const SCHEDULE_HEADER = "session,week,home,away";
/** schedule.csv header when any fixture carries an agreed spot. */
const SCHEDULE_HEADER_WITH_SPOT = "session,week,home,away,spotHome,spotAway";

/** Fixed, deterministic date: dates are not persisted and the engine ignores them. */
const MATCH_DATE = new Date("2026-01-01T00:00:00Z");

export interface CsvLeagueStoreOptions {
  /** Rating engine used to derive each match's spot ratings (see `spotRatingsFor`). */
  engine?: RatingEngine;
  /** Ball-spot ladder. Defaults to {@link DEFAULT_HANDICAP_TABLE}. */
  handicapTable?: readonly HandicapTier[];
}

/**
 * A CSV-backed {@link LeagueRepository}. Reads a directory holding these files:
 *
 *   players.csv    →  id, fargo, name
 *   games.csv      →  session, matchId, week, home, away, winner, loserBalls,
 *                     forfeit, spotHome, spotAway
 *                     (one row per game; `week` is 1-based WITHIN the session)
 *   divisions.csv  →  session, division, player[, label]   (OPTIONAL file)
 *                     (one row per player per session; absent = undivided)
 *   schedule.csv   →  session, week, home, away[, spotHome, spotAway]
 *                     (OPTIONAL file; one row per planned fixture)
 *
 * The trailing `forfeit`, `spotHome` and `spotAway` columns are optional and
 * backward-compatible: a legacy file without them reads as all-played with
 * rating-derived spots, and the first append upgrades the file in place,
 * backfilling `0` / blank on existing rows. A forfeit is a single row with
 * `forfeit=1`, `winner` set to the player awarded the win, and no games — it
 * counts in the standings but is ignored by ratings and spots.
 *
 * **Agreed spots.** `spotHome`/`spotAway` are blank on a normal match. Filled
 * in (both, on every row of the match), they are a spot the players agreed to
 * instead of the ratings' — e.g. "play this one even" for an underrated player
 * — and that spot is used for the match as-is. It is a recorded fact, like the
 * ball counts, so the rating engine reads the games against the spot they were
 * really played under. The same two columns on schedule.csv announce an agreed
 * spot ahead of time, so the schedule and the weekly email can show it; the
 * schedule is a plan and never sets a result's spot by itself.
 *
 * divisions.csv is optional and purely declarative — it names the player groups
 * within a session and nothing else. It is read, never written: a division is a
 * roster decision, so it is made in the spreadsheet (or from `draftDivisions`)
 * and the store just reflects it. A session with no rows is undivided, which is
 * the right shape for a playoff bracket. Because it is read independently of the
 * game log, a session that exists ONLY in divisions.csv still loads — that is
 * what makes a pre-season view possible, showing each division's roster at 0-0
 * before a single game is played.
 *
 * schedule.csv holds *plans*, and is the only file the store rewrites rather
 * than appends to — see {@link CsvLeagueStore.replaceSchedule}. It is
 * deliberately decoupled from the game log: a schedule is a statement of intent,
 * results are facts, and neither validates the other. Play a fixture out of
 * order, swap seats, add a makeup match, delete a week — the results stand and
 * the schedule stays whatever the file says. That decoupling is what makes the
 * file safe to hand-edit, and safe for another application to generate.
 *
 * Sessions are ordered by first appearance in games.csv (index 1, 2, …), then by
 * any session known only from divisions.csv. Ball spots are NOT stored — they
 * are derived per league policy: each match's spot
 * comes from the two players' **spot ratings**, which re-base every 10 games per
 * player (see `spotRatingsFor`). Reconstruction is a forward pass in
 * chronological order: each match is spotted from the ratings in effect just
 * before it, then appended so it counts toward the next match's spots. A player
 * with fewer than 10 games on record is still spotted from their Fargo seed.
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
    const divisions = this.loadDivisions(known);
    const sessions = buildSessions(drafts, divisions);
    const matches = this.assembleMatches(players, sessions, drafts);
    const schedule = this.loadFixtures(known);

    return { players, matches, sessions, schedule };
  }

  appendMatch(match: NewMatch): MatchId {
    if (match.home === match.away) {
      throw new Error(`A player cannot play themselves: "${match.home}"`);
    }

    const players = this.loadPlayers();
    const known = new Set(players.map((p) => p.id));
    for (const id of [match.home, match.away]) {
      if (!known.has(id)) {
        throw new Error(`Unknown player "${id}"`);
      }
    }

    const matchId =
      match.matchId ?? this.nextMatchId(match.sessionId, match.week);

    if (match.agreedSpot) {
      if (match.forfeit) {
        throw new Error("A forfeit has no games, so it cannot carry a spot");
      }
      validateSpot(match.agreedSpot, `agreed spot for ${match.home} vs ${match.away}`);
    }
    const spotCells = match.agreedSpot
      ? [match.agreedSpot.home, match.agreedSpot.away]
      : ["", ""];

    // Older logs predate the trailing columns; upgrade in place before writing
    // so every row in the file has the same shape.
    this.ensureGamesColumns();

    let rows: string[];
    if (match.forfeit) {
      const winner = match.forfeitWinner;
      if (winner !== match.home && winner !== match.away) {
        throw new Error(
          `A forfeit's winner "${winner}" must be home or away ` +
            `(${match.home} vs ${match.away})`,
        );
      }
      // A forfeit is one row, no games: winner set, no balls, forfeit flag on.
      rows = [
        [
          match.sessionId,
          matchId,
          match.week,
          match.home,
          match.away,
          winner,
          0,
          1,
          ...spotCells,
        ].join(","),
      ];
    } else {
      if (match.games.length === 0) {
        throw new Error("A match must have at least one game");
      }
      for (const [i, g] of match.games.entries()) {
        if (g.winner !== match.home && g.winner !== match.away) {
          throw new Error(
            `Game ${i + 1} winner "${g.winner}" is not in this match ` +
              `(${match.home} vs ${match.away})`,
          );
        }
        // A loser's total can be negative: in one pocket each foul costs a
        // ball, so a player can finish below zero.
        if (!Number.isInteger(g.loserBalls)) {
          throw new Error(`Game ${i + 1} loserBalls must be a whole number`);
        }
      }
      rows = match.games.map((g) =>
        [
          match.sessionId,
          matchId,
          match.week,
          match.home,
          match.away,
          g.winner,
          g.loserBalls,
          0,
          ...spotCells,
        ].join(","),
      );
    }
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

  replaceSchedule(
    sessionId: SessionId,
    fixtures: readonly Fixture[],
  ): number {
    const players = this.loadPlayers();
    const known = new Set(players.map((p) => p.id));

    // Validate the whole batch before touching the file, so a bad fixture
    // cannot leave a session half-scheduled.
    const seenThisWeek = new Map<number, Set<PlayerId>>();
    for (const f of fixtures) {
      if (f.sessionId !== sessionId) {
        throw new Error(
          `Fixture for session "${f.sessionId}" passed to replaceSchedule("${sessionId}")`,
        );
      }
      validateFixture(f, known, seenThisWeek);
    }

    // Rewrite the file, dropping this session's old rows and keeping the rest.
    const kept = this.loadFixtures(known).filter(
      (f) => f.sessionId !== sessionId,
    );
    const all = [...kept, ...fixtures];
    // The spot columns appear only once some fixture needs them, so a file
    // with no agreed spots keeps its original four-column shape.
    const withSpot = all.some((f) => f.agreedSpot);
    const rows = all.map((f) => {
      const cells: (string | number)[] = [f.sessionId, f.week, f.home, f.away];
      if (withSpot) {
        cells.push(f.agreedSpot?.home ?? "", f.agreedSpot?.away ?? "");
      }
      return cells.join(",");
    });
    const header = withSpot ? SCHEDULE_HEADER_WITH_SPOT : SCHEDULE_HEADER;
    writeFileSync(
      this.path(SCHEDULE_FILE),
      `${header}\n${rows.length > 0 ? rows.join("\n") + "\n" : ""}`,
      "utf8",
    );
    return fixtures.length;
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
      players.push(
        seedPlayer(id, row.name!, parseNumber(row.fargo!, `fargo for "${id}"`)),
      );
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
      // `forfeit` is optional (legacy files omit it); "1"/"true" mean forfeit.
      const forfeit = row.forfeit === "1" || row.forfeit === "true";
      const agreedSpot = parseSpotCells(row, `match "${id}" in ${GAMES_FILE}`);

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
        if (agreedSpot) draft.agreedSpot = agreedSpot;
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
      } else if (
        draft.agreedSpot?.home !== agreedSpot?.home ||
        draft.agreedSpot?.away !== agreedSpot?.away
      ) {
        // One spot per match: every game is played under the same one.
        throw new Error(
          `Match "${id}" has different spotHome/spotAway across its rows`,
        );
      }

      if (forfeit && agreedSpot) {
        throw new Error(
          `Forfeit match "${id}" has no games, so it cannot carry a spot`,
        );
      }

      if (forfeit) {
        // A forfeit is a single self-contained row with no games. Mixing it
        // with played games (or a second forfeit row) under one id is a
        // malformed log.
        if (draft.games.length > 0 || draft.forfeit) {
          throw new Error(
            `Forfeit match "${id}" must be a single row with no played games`,
          );
        }
        draft.forfeit = true;
        draft.forfeitWinner = winner;
      } else {
        if (draft.forfeit) {
          throw new Error(
            `Match "${id}" mixes a forfeit row with played games`,
          );
        }
        const loserBalls = parseNumber(
          row.loserBalls!,
          `loserBalls for "${id}"`,
        );
        draft.games.push({ winner, loserBalls });
      }
    }

    return order.map((id) => byId.get(id)!);
  }

  /**
   * Read divisions.csv into per-session division lists, or an empty map when the
   * file is absent (every session undivided). Division order, and player order
   * within a division, follow the file so the spreadsheet stays the source of
   * truth for presentation too.
   *
   * `label` is an optional fourth column; without it a division is titled from
   * its id (`a` → "Division A"). The first labelled row for a division wins.
   */
  private loadDivisions(known: Set<string>): Map<SessionId, Division[]> {
    const path = this.path(DIVISIONS_FILE);
    const bySession = new Map<SessionId, Division[]>();
    if (!existsSync(path)) {
      return bySession;
    }
    const rows = parseCsv(readFileSync(path, "utf8"));
    requireColumns(rows, ["session", "division", "player"], DIVISIONS_FILE);

    // Guards against the two mistakes a hand-edited draft actually makes:
    // a typo'd player id, and the same player left in two divisions.
    // session -> player -> the division they are already placed in.
    const placed = new Map<SessionId, Map<PlayerId, string>>();

    for (const row of rows) {
      const sessionId = row.session!;
      const divisionId = row.division!;
      const player = row.player!;
      const label = row.label;

      if (!known.has(player)) {
        throw new Error(
          `Unknown player "${player}" in ${DIVISIONS_FILE} ` +
            `(session ${sessionId}, division ${divisionId})`,
        );
      }
      let placedInSession = placed.get(sessionId);
      if (!placedInSession) {
        placedInSession = new Map();
        placed.set(sessionId, placedInSession);
      }
      const already = placedInSession.get(player);
      if (already !== undefined) {
        if (already === divisionId) {
          throw new Error(
            `Player "${player}" is listed twice in division "${divisionId}" ` +
              `of session "${sessionId}" in ${DIVISIONS_FILE}`,
          );
        }
        throw new Error(
          `Player "${player}" is in two divisions of session "${sessionId}" ` +
            `("${already}" and "${divisionId}") in ${DIVISIONS_FILE}`,
        );
      }
      placedInSession.set(player, divisionId);

      let divisions = bySession.get(sessionId);
      if (!divisions) {
        divisions = [];
        bySession.set(sessionId, divisions);
      }
      let division = divisions.find((d) => d.id === divisionId);
      if (!division) {
        division = {
          id: divisionId,
          label: label || defaultDivisionLabel(divisionId),
          playerIds: [],
        };
        divisions.push(division);
      } else if (label && division.label === defaultDivisionLabel(divisionId)) {
        division.label = label;
      }
      division.playerIds.push(player);
    }
    return bySession;
  }

  /**
   * Read schedule.csv, or an empty list when the file is absent (nothing
   * scheduled yet). Rows keep file order, so a hand-arranged file reads back the
   * way it was written.
   *
   * Validation targets exactly what hand-editing breaks: a typo'd player id, a
   * player booked against themselves, and a player booked twice in one week.
   * Anything the file says beyond that is honored — an unbalanced week, a
   * missing week, a rematch — because those are legitimate scheduling choices,
   * not mistakes the store gets to veto.
   */
  private loadFixtures(known: Set<string>): Fixture[] {
    const path = this.path(SCHEDULE_FILE);
    if (!existsSync(path)) {
      return [];
    }
    const rows = parseCsv(readFileSync(path, "utf8"));
    requireColumns(rows, ["session", "week", "home", "away"], SCHEDULE_FILE);

    const fixtures: Fixture[] = [];
    // session -> week -> players already booked that week.
    const seen = new Map<SessionId, Map<number, Set<PlayerId>>>();
    for (const row of rows) {
      const sessionId = row.session!;
      const fixture: Fixture = {
        sessionId,
        week: parseNumber(row.week!, `week in ${SCHEDULE_FILE}`),
        home: row.home!,
        away: row.away!,
      };
      const agreedSpot = parseSpotCells(
        row,
        `${SCHEDULE_FILE} (session ${sessionId}, week ${fixture.week}, ` +
          `${fixture.home} vs ${fixture.away})`,
      );
      if (agreedSpot) fixture.agreedSpot = agreedSpot;
      let bySession = seen.get(sessionId);
      if (!bySession) {
        bySession = new Map();
        seen.set(sessionId, bySession);
      }
      validateFixture(fixture, known, bySession);
      fixtures.push(fixture);
    }
    return fixtures;
  }

  /**
   * Forward pass, in chronological order (sessions by index, drafts in file
   * order within each), assigning every match the ball spot in effect just
   * before it: each player's spot rating re-bases every 10 games, so the spots
   * step forward through the season rather than freezing at a session boundary.
   * Because each match is spotted only from matches already pushed, the pass is
   * causal — a match never depends on its own or any later result.
   */
  private assembleMatches(
    players: readonly Player[],
    sessions: readonly Session[],
    drafts: readonly MatchDraft[],
  ): Match[] {
    const ordered = sessions.flatMap((s) =>
      drafts.filter((d) => d.sessionId === s.id),
    );
    const matches: Match[] = [];
    for (const d of ordered) {
      // An agreed spot is a recorded fact and stands as written; only the
      // rest are derived from the spot ratings in effect before the match.
      if (d.agreedSpot) {
        matches.push(buildMatch(d, d.agreedSpot));
        continue;
      }
      const spot = spotRatingsFor(this.engine, players, matches);
      const ratingById = new Map(spot.map((r) => [r.playerId, r.leagueRating]));
      const ballSpot = ballSpotForRatings(
        this.handicapTable,
        ratingById.get(d.home)!,
        ratingById.get(d.away)!,
      );
      matches.push(buildMatch(d, ballSpot));
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

  /**
   * Upgrade a legacy games.csv (written before some of the trailing
   * {@link GAMES_OPTIONAL_COLUMNS} existed) to the current shape, in place:
   * append each missing column to the header and its fill value (`0` for
   * `forfeit`, blank for the spot columns) to every data row. No-op when the
   * file is absent (a fresh append writes the new header) or already current.
   * Keeps every row in the file the same width so {@link parseCsv} stays happy
   * after we append full-width rows.
   */
  private ensureGamesColumns(): void {
    const path = this.path(GAMES_FILE);
    if (!existsSync(path)) {
      return;
    }
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    const headerIdx = lines.findIndex((l) => l.trim().length > 0);
    if (headerIdx === -1) {
      return; // effectively empty; the append will (re)write the header
    }
    const header = lines[headerIdx]!.split(",").map((h) => h.trim());
    const missing = GAMES_OPTIONAL_COLUMNS.filter(([c]) => !header.includes(c));
    if (missing.length === 0) {
      return; // already current
    }
    const headerCells = missing.map(([c]) => `,${c}`).join("");
    const rowCells = missing.map(([, fill]) => `,${fill}`).join("");
    const upgraded = lines.map((line, i) => {
      if (i === headerIdx) return `${line}${headerCells}`;
      if (i < headerIdx || line.trim().length === 0) return line; // blanks untouched
      return `${line}${rowCells}`;
    });
    writeFileSync(path, upgraded.join("\n"), "utf8");
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
  /** A forfeit draft: awarded to {@link forfeitWinner}, with no games. */
  forfeit?: boolean;
  forfeitWinner?: string;
  /** A spot recorded with the games, used instead of the rating-derived one. */
  agreedSpot?: BallSpot;
}

/**
 * Reads the optional `spotHome`/`spotAway` cells of a row: `undefined` when
 * both are blank or the columns are absent, a validated spot when both are set.
 * Exactly one set is a half-typed edit and is rejected rather than guessed at.
 */
function parseSpotCells(
  row: Record<string, string>,
  where: string,
): BallSpot | undefined {
  const h = row.spotHome ?? "";
  const a = row.spotAway ?? "";
  if (h === "" && a === "") return undefined;
  if (h === "" || a === "") {
    throw new Error(`Set both spotHome and spotAway, or neither, in ${where}`);
  }
  const spot = {
    home: parseNumber(h, `spotHome in ${where}`),
    away: parseNumber(a, `spotAway in ${where}`),
  };
  validateSpot(spot, where);
  return spot;
}

/** A spot is a positive whole-ball target for each side. */
function validateSpot(spot: BallSpot, where: string): void {
  for (const n of [spot.home, spot.away]) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `A ball spot must be whole numbers of at least 1 (${where}), ` +
          `got ${spot.home}-${spot.away}`,
      );
    }
  }
}

/**
 * Checks one fixture and records its participants, throwing on the three things
 * a hand edit gets wrong. `bookedByWeek` is mutated: it accumulates who is
 * already playing in each week so a double-booking is caught.
 */
function validateFixture(
  fixture: Fixture,
  known: Set<string>,
  bookedByWeek: Map<number, Set<PlayerId>>,
): void {
  const { sessionId, week, home, away } = fixture;
  const where = `${SCHEDULE_FILE} (session ${sessionId}, week ${week})`;

  if (!Number.isInteger(week) || week < 1) {
    throw new Error(`Week must be a positive integer in ${where}`);
  }
  for (const id of [home, away]) {
    if (!known.has(id)) {
      throw new Error(`Unknown player "${id}" in ${where}`);
    }
  }
  if (home === away) {
    throw new Error(`A player cannot play themselves ("${home}") in ${where}`);
  }
  if (fixture.agreedSpot) {
    validateSpot(fixture.agreedSpot, where);
  }

  let booked = bookedByWeek.get(week);
  if (!booked) {
    booked = new Set();
    bookedByWeek.set(week, booked);
  }
  for (const id of [home, away]) {
    if (booked.has(id)) {
      throw new Error(`Player "${id}" is scheduled twice in ${where}`);
    }
    booked.add(id);
  }
}

/** Titles a division from its id when divisions.csv gives no label: `a` → "Division A". */
function defaultDivisionLabel(divisionId: string): string {
  return `Division ${divisionId.toUpperCase()}`;
}

/**
 * Session metadata derived from the grouped drafts: order and index by first
 * appearance, roster from the players seen, length from the highest week.
 *
 * Sessions named only in divisions.csv are appended after the played ones, so a
 * session that has been drafted but not yet played still loads (with `weeks: 0`)
 * and its divisions can be shown at 0-0 before week 1.
 *
 * A session's roster is the union of its division rosters and everyone who
 * actually played in it — the divisions lead, in file order, so the roster reads
 * the way the draft was written. The two sets normally coincide; when they do
 * not, the game log is the side that must not be silently dropped.
 */
function buildSessions(
  drafts: readonly MatchDraft[],
  divisionsBySession: Map<SessionId, Division[]> = new Map(),
): Session[] {
  const order: string[] = [];
  for (const d of drafts) {
    if (!order.includes(d.sessionId)) order.push(d.sessionId);
  }
  for (const id of divisionsBySession.keys()) {
    if (!order.includes(id)) order.push(id);
  }
  return order.map((id, i) => {
    const own = drafts.filter((d) => d.sessionId === id);
    const divisions = divisionsBySession.get(id) ?? [];
    const roster = [
      ...new Set([
        ...divisions.flatMap((d) => d.playerIds),
        ...own.flatMap((d) => [d.home, d.away]),
      ]),
    ];
    const weeks = own.reduce((max, d) => Math.max(max, d.week), 0);
    return { id, label: id, index: i + 1, weeks, playerIds: roster, divisions };
  });
}

/**
 * Builds a Match from a draft and its ball spot. The winner's ball total for
 * each game is their target (they had to reach it to win); the loser's is the
 * reported `loserBalls`. `winner` and `score` are derived.
 */
function buildMatch(
  draft: MatchDraft,
  ballSpot: { home: number; away: number },
): Match {
  if (draft.forfeit) {
    const winner = draft.forfeitWinner!;
    const homeWon = winner === draft.home;
    return {
      id: draft.id,
      date: MATCH_DATE,
      sessionId: draft.sessionId,
      week: draft.week,
      home: draft.home,
      away: draft.away,
      ballSpot,
      winner,
      // Full race awarded to the winner; no games were played.
      score: homeWon
        ? { home: RACE_TO_GAMES, away: 0 }
        : { home: 0, away: RACE_TO_GAMES },
      raceToGames: RACE_TO_GAMES,
      forfeit: true,
      games: [],
    };
  }
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
    ...(draft.agreedSpot ? { spotAgreed: true } : {}),
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

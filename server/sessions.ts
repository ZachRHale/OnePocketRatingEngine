/**
 * The league's session catalog — the app's answer to "what seasons exist?".
 *
 * It lives here rather than in `server.ts` because more than one consumer needs
 * it: the web app, and the weekly report generator. Both must agree on a
 * session's label, length and divisions, so both read it from one place.
 *
 * This is app configuration, not league logic: the library knows what a session
 * *is*, this file knows which ones this league is running.
 */
import type { Division, LeagueData, SessionId } from "../src/index.js";

/**
 * Nine weeks is one complete round-robin for a nine-player division (every
 * player meets all eight opponents and takes exactly one bye). An eight-player
 * division finishes its round-robin in seven and plays two rematches with
 * home/away flipped — see `buildSchedule`. Two playoff weeks cover a four-team
 * bracket: two semifinals, then the final.
 */
export const REGULAR_SEASON_WEEKS = 9;
export const PLAYOFF_WEEKS = 2;

export interface KnownSession {
  id: string;
  label: string;
  weeks: number;
  /** A playoff bracket rather than a divisional regular season. */
  playoffs?: boolean;
}

/**
 * The league's planned sessions, in running order. These populate the UI
 * dropdown even before any games are recorded, so results can be entered for an
 * upcoming season. Edit this list to add or rename seasons; a session's `id` is
 * what gets written into games.csv, so keep it stable once it has games.
 *
 * Each season is TWO sessions: a divisional regular season, then its playoff.
 * The split is deliberate — standings reset per session, which is exactly what a
 * bracket wants, and it keeps playoff results out of the division races without
 * any special-casing. Ratings and ball spots are unaffected either way: they
 * ignore session boundaries entirely, so a cross-division playoff match is
 * handicapped correctly on day one.
 */
export const KNOWN_SESSIONS: KnownSession[] = [
  { id: "spring-2026", label: "Spring 2026", weeks: REGULAR_SEASON_WEEKS },
  {
    id: "spring-2026-playoffs",
    label: "Spring 2026 — Playoffs",
    weeks: PLAYOFF_WEEKS,
    playoffs: true,
  },
  { id: "summer-2026", label: "Summer 2026", weeks: REGULAR_SEASON_WEEKS },
  {
    id: "summer-2026-playoffs",
    label: "Summer 2026 — Playoffs",
    weeks: PLAYOFF_WEEKS,
    playoffs: true,
  },
  { id: "fall-2026", label: "Fall 2026", weeks: REGULAR_SEASON_WEEKS },
  {
    id: "fall-2026-playoffs",
    label: "Fall 2026 — Playoffs",
    weeks: PLAYOFF_WEEKS,
    playoffs: true,
  },
  { id: "winter-2026", label: "Winter 2026", weeks: REGULAR_SEASON_WEEKS },
  {
    id: "winter-2026-playoffs",
    label: "Winter 2026 — Playoffs",
    weeks: PLAYOFF_WEEKS,
    playoffs: true,
  },
];

/** One session as the UI needs it: the planned list, plus anything already in
 *  the data (e.g. legacy ids) appended so no recorded session is ever hidden. */
export interface SessionView {
  id: string;
  label: string;
  index: number;
  weeks: number;
  players: string[];
  /** The session's divisions; empty when undivided (e.g. a playoff bracket). */
  divisions: Division[];
  /** A playoff bracket rather than a divisional regular season. */
  playoffs: boolean;
  /** Whether any games have been recorded for this session yet. */
  hasGames: boolean;
}

export function sessionViews(data: LeagueData): SessionView[] {
  const byId = new Map(data.sessions.map((s) => [s.id, s]));
  const views: SessionView[] = [];
  const seen = new Set<string>();
  for (const known of KNOWN_SESSIONS) {
    const d = byId.get(known.id);
    views.push({
      id: known.id,
      label: known.label,
      index: views.length + 1,
      // A drafted-but-unplayed session has no weeks on record yet; fall back to
      // the plan so the UI can say how long the session is meant to run.
      weeks: d && d.weeks > 0 ? d.weeks : known.weeks,
      players: d ? d.playerIds : [],
      divisions: d ? d.divisions : [],
      playoffs: known.playoffs === true,
      hasGames: d !== undefined && d.weeks > 0,
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
      divisions: d.divisions,
      playoffs: false,
      hasGames: d.weeks > 0,
    });
  }
  return views;
}

/** Resolve the session to show: an explicit id, else the latest played, else
 *  the first planned session. */
export function resolveSession(
  data: LeagueData,
  requested: string | null,
): SessionId {
  if (requested) return requested;
  const latest = [...data.sessions].sort((a, b) => b.index - a.index)[0];
  return latest?.id ?? KNOWN_SESSIONS[0]!.id;
}

export const PLAYOFF_SUFFIX = "-playoffs";

/**
 * The regular-season session a playoff bracket follows from, by naming
 * convention (`spring-2026-playoffs` → `spring-2026`), or `null` for a session
 * that is not a playoff. The convention is the only link between the two: it
 * keeps the pairing out of the data files, at the cost of requiring the ids to
 * match.
 */
export function regularSeasonFor(sessionId: SessionId): SessionId | null {
  return sessionId.endsWith(PLAYOFF_SUFFIX)
    ? sessionId.slice(0, -PLAYOFF_SUFFIX.length)
    : null;
}

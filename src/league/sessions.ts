import type { Match, Player, Session, SessionId } from "../domain/index.js";
import type { PlayerRating, RatingEngine } from "../rating/index.js";

/**
 * Layer 3 — League Logic.
 *
 * Session-aware queries over already-recorded facts. Nothing here computes a
 * rating itself — it slices match history by session and asks a
 * {@link RatingEngine} the right question. The whole point is to realize the
 * league's chosen policy: **ratings are frozen per session, skill carries over
 * in full.**
 */

/** The matches played in one session, in their original order. */
export function matchesInSession(
  matches: readonly Match[],
  sessionId: SessionId,
): Match[] {
  return matches.filter((m) => m.sessionId === sessionId);
}

/** Look up a session by id, or throw. */
function sessionById(
  sessions: readonly Session[],
  sessionId: SessionId,
): Session {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error(`Unknown session "${sessionId}"`);
  }
  return session;
}

/**
 * Ratings folded over every match in sessions with an index at or below
 * `throughIndex`. With `throughIndex` below the earliest session, no matches are
 * folded and everyone sits at their Fargo seed.
 */
function ratingsThroughIndex(
  engine: RatingEngine,
  players: readonly Player[],
  matches: readonly Match[],
  sessions: readonly Session[],
  throughIndex: number,
): PlayerRating[] {
  const includedIds = new Set(
    sessions.filter((s) => s.index <= throughIndex).map((s) => s.id),
  );
  const history = matches.filter((m) => includedIds.has(m.sessionId));
  return engine.calculateRatings({ players, matches: history });
}

/**
 * The **frozen** ratings that govern `sessionId`: the engine folded over every
 * match from *earlier* sessions only (index strictly less than this one). These
 * are the numbers to read when setting this session's ball spots — they do not
 * move once the session is under way.
 *
 * For the very first session this returns the Fargo seeds (no prior history),
 * which is exactly the intended behavior.
 */
export function frozenRatingsForSession(
  engine: RatingEngine,
  players: readonly Player[],
  matches: readonly Match[],
  sessions: readonly Session[],
  sessionId: SessionId,
): PlayerRating[] {
  const session = sessionById(sessions, sessionId);
  return ratingsThroughIndex(
    engine,
    players,
    matches,
    sessions,
    session.index - 1,
  );
}

/**
 * The ratings as they stand at the END of `sessionId` — the engine folded over
 * this session and all earlier ones. This is the "current" rating to publish
 * once a session closes; it becomes the frozen rating for the next session.
 */
export function ratingsAfterSession(
  engine: RatingEngine,
  players: readonly Player[],
  matches: readonly Match[],
  sessions: readonly Session[],
  sessionId: SessionId,
): PlayerRating[] {
  const session = sessionById(sessions, sessionId);
  return ratingsThroughIndex(engine, players, matches, sessions, session.index);
}

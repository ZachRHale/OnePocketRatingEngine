import type { PlayerId, SessionId } from "../domain/index.js";

/**
 * Layer 3 — League Logic.
 *
 * A single scheduled pairing for a week. This is a *fixture* (who plays whom),
 * not a result — it carries no games or score. `home` and `away` mirror the
 * neutral meaning used on {@link Match}: they are just the two seats, and which
 * seat a player takes is balanced across the season (see {@link buildSchedule}).
 */
export interface ScheduledMatch {
  home: PlayerId;
  away: PlayerId;
}

/** All pairings for one week, plus whoever sits out (only when byes occur). */
export interface WeekSchedule {
  /** 1-based week number. */
  week: number;
  matches: ScheduledMatch[];
  /** The player with a bye this week, if the roster is odd. */
  bye?: PlayerId;
}

export interface ScheduleOptions {
  /**
   * How many rounds to advance the rotation before week 1. Within a single
   * session leave this at 0. Across sessions, pass a per-session offset (e.g.
   * the session's index) so the "extra" byes and rematches of a partial cycle
   * land on *different* players each session — fairness across sessions without
   * tracking any bye-debt. Any non-negative integer works; it wraps around the
   * cycle length.
   */
  rotation?: number;
}

/**
 * Builds a round-robin season schedule using the classic **circle method**.
 *
 * The roster is seated in a circle with one seat fixed; every week the other
 * seats rotate one step, so each player meets a new opponent. A full cycle is
 * `players - 1` weeks (even roster) or `players` weeks (odd roster), after which
 * every player has met every other exactly once.
 *
 * Byes: with an odd roster a phantom seat is added, and whoever is paired with
 * it that week sits out. The rotation spreads that phantom evenly, so **every
 * player gets exactly one bye per cycle** — the fair "bye when possible".
 *
 * Length: `weeks` is honored exactly.
 *   - `weeks < cycle` → the opening `weeks` rounds of a single round-robin.
 *   - `weeks === cycle` → one complete round-robin.
 *   - `weeks > cycle` → the schedule repeats. Home/away is flipped on each
 *     repeat, so across a double round-robin every pairing is played once from
 *     each side and home/away counts come out even.
 *
 * @param playerIds Roster, at least two, no duplicates.
 * @param weeks     Number of weeks to generate (non-negative).
 */
export function buildSchedule(
  playerIds: readonly PlayerId[],
  weeks: number,
  options: ScheduleOptions = {},
): WeekSchedule[] {
  if (!Number.isInteger(weeks) || weeks < 0) {
    throw new Error(`weeks must be a non-negative integer, got ${weeks}`);
  }
  const rotation = options.rotation ?? 0;
  if (!Number.isInteger(rotation) || rotation < 0) {
    throw new Error(`rotation must be a non-negative integer, got ${rotation}`);
  }
  if (playerIds.length < 2) {
    throw new Error("A schedule needs at least two players");
  }
  const unique = new Set(playerIds);
  if (unique.size !== playerIds.length) {
    throw new Error("Duplicate player ids in roster");
  }

  // Seat the roster; a `null` seat is the phantom that creates byes when the
  // roster is odd. `seats` always has an even length so pairs are symmetric.
  const seats: (PlayerId | null)[] = [...playerIds];
  if (seats.length % 2 !== 0) {
    seats.push(null);
  }
  const n = seats.length;
  const roundsPerCycle = n - 1;

  const schedule: WeekSchedule[] = [];
  let arr = [...seats];

  // Pre-advance the rotation so a per-session offset shifts who gets byes.
  const rotate = (a: (PlayerId | null)[]): (PlayerId | null)[] => [
    a[0]!,
    a[n - 1]!,
    ...a.slice(1, n - 1),
  ];
  for (let r = rotation % roundsPerCycle; r > 0; r--) {
    arr = rotate(arr);
  }

  for (let w = 0; w < weeks; w++) {
    // Flip home/away on each full repeat of the round-robin so that, over a
    // double round-robin, every pairing is played once from each seat.
    const flip = Math.floor(w / roundsPerCycle) % 2 === 1;

    const matches: ScheduledMatch[] = [];
    let bye: PlayerId | undefined;
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i]!;
      const b = arr[n - 1 - i]!;
      if (a === null) {
        bye = b ?? undefined;
        continue;
      }
      if (b === null) {
        bye = a;
        continue;
      }
      matches.push(flip ? { home: b, away: a } : { home: a, away: b });
    }

    schedule.push(bye ? { week: w + 1, matches, bye } : { week: w + 1, matches });

    // Rotate every seat but the first one step clockwise (circle method).
    arr = rotate(arr);
  }

  return schedule;
}

/**
 * One persisted fixture: a scheduled pairing pinned to a session and week.
 *
 * This is the row shape of schedule.csv. Where {@link ScheduledMatch} is what
 * {@link buildSchedule} produces in memory, a `Fixture` is what survives to
 * disk — and therefore what a human (or another app) can edit.
 */
export interface Fixture {
  sessionId: SessionId;
  /** Week WITHIN the session (1-based). */
  week: number;
  home: PlayerId;
  away: PlayerId;
}

/**
 * One week of a *loaded* schedule. Distinct from {@link WeekSchedule} in one
 * deliberate way: `byes` is a list, not a single player.
 *
 * {@link buildSchedule} generates at most one bye per week by construction, so
 * its output can promise a single player. A schedule read back from disk has
 * been through human hands, and a hand-edited week can legitimately leave
 * several players out — someone travelling, a makeup week, a division playing
 * short. Reporting that as `bye: undefined` would hide it; reporting a list
 * shows it.
 */
export interface ScheduledWeek {
  /** 1-based week number. */
  week: number;
  matches: ScheduledMatch[];
  /** Roster players with no fixture this week, in roster order. */
  byes: PlayerId[];
}

/**
 * Groups loaded {@link Fixture}s into weeks, ascending, deriving byes.
 *
 * Byes are *derived*, never stored: a player has a bye in a week exactly when
 * they are on `roster` and appear in none of that week's fixtures. Storing them
 * would create a second source of truth that a hand edit could contradict —
 * move a fixture and the bye list silently becomes a lie. Deriving them means
 * the bye list cannot disagree with the fixtures it came from.
 *
 * Only weeks with at least one fixture appear. Pass the division roster (not the
 * whole league) to get that division's byes.
 */
export function fixturesToWeeks(
  fixtures: readonly Fixture[],
  roster: readonly PlayerId[] = [],
): ScheduledWeek[] {
  const byWeek = new Map<number, ScheduledMatch[]>();
  for (const f of fixtures) {
    let week = byWeek.get(f.week);
    if (!week) {
      week = [];
      byWeek.set(f.week, week);
    }
    week.push({ home: f.home, away: f.away });
  }

  return [...byWeek.keys()]
    .sort((a, b) => a - b)
    .map((week) => {
      const matches = byWeek.get(week)!;
      const playing = new Set(matches.flatMap((m) => [m.home, m.away]));
      return {
        week,
        matches,
        byes: roster.filter((id) => !playing.has(id)),
      };
    });
}

/**
 * Flattens generated {@link WeekSchedule}s into persistable {@link Fixture}s for
 * one session. Byes are dropped: they carry no information once the fixtures are
 * written, because {@link fixturesToWeeks} derives them back.
 */
export function fixturesFor(
  sessionId: SessionId,
  weeks: readonly WeekSchedule[],
): Fixture[] {
  return weeks.flatMap((w) =>
    w.matches.map((m) => ({
      sessionId,
      week: w.week,
      home: m.home,
      away: m.away,
    })),
  );
}

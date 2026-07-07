import type { PlayerId } from "../domain/index.js";

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

import type { Division, DivisionId, PlayerId } from "../domain/index.js";

/**
 * Layer 3 — League Logic.
 *
 * One player's input to a draft: who they are and how strong they are. The
 * rating can be anything comparable on one scale — a Fargo seed for a brand-new
 * league, or (better, once there is history) each player's spot rating.
 */
export interface DraftEntry {
  playerId: PlayerId;
  rating: number;
}

export interface DraftDivisionsOptions {
  /**
   * Labels for the drafted divisions, in order. Missing entries fall back to
   * "Division A", "Division B", … Ids are always `a`, `b`, `c`, …
   */
  labels?: readonly string[];
}

/**
 * Splits a roster into `divisionCount` balanced divisions.
 *
 * Divisions are re-drafted every session, so this is the function that makes
 * that cheap: feed it the roster and current ratings and it returns the split to
 * write into divisions.csv.
 *
 * **Sizes** are as even as the roster allows, larger divisions first: 17 players
 * into 2 gives 9 and 8.
 *
 * **Balance** starts from a serpentine draft (A, B, B, A, A, …), the standard
 * way to keep a snake fair, then runs a swap-refinement pass: repeatedly apply
 * the single cross-division swap that most reduces the spread between division
 * averages, stopping when no swap helps. Serpentine alone leaves a systematic
 * tilt when the roster does not divide evenly — the division holding the extra
 * pick also absorbs the weakest player — and the refinement pass is what closes
 * that gap. Every step is deterministic: same roster and ratings in, same
 * divisions out, with ties broken by player id so the result never depends on
 * input order.
 *
 * A caveat worth stating plainly: because every match is handicapped by ball
 * spot, division *strength* balance is mostly cosmetic — it keeps one division
 * from looking stacked. The scheduling constraints that actually bite (who can
 * play which night) are not modeled here, so treat the output as a starting
 * proposal to edit, not a fixture.
 *
 * @param entries       The roster with ratings. At least `divisionCount` players.
 * @param divisionCount How many divisions to draft (>= 1).
 */
export function draftDivisions(
  entries: readonly DraftEntry[],
  divisionCount: number,
  options: DraftDivisionsOptions = {},
): Division[] {
  if (!Number.isInteger(divisionCount) || divisionCount < 1) {
    throw new Error(
      `divisionCount must be a positive integer, got ${divisionCount}`,
    );
  }
  const ids = new Set(entries.map((e) => e.playerId));
  if (ids.size !== entries.length) {
    throw new Error("Duplicate player ids in the draft pool");
  }
  if (entries.length < divisionCount) {
    throw new Error(
      `Cannot draft ${divisionCount} divisions from ${entries.length} player(s)`,
    );
  }

  // Strongest first; player id breaks ties so the draft is order-independent.
  const pool = [...entries].sort(
    (a, b) => b.rating - a.rating || a.playerId.localeCompare(b.playerId),
  );

  // As even as possible, larger divisions first: 17 into 2 → [9, 8].
  const base = Math.floor(pool.length / divisionCount);
  const remainder = pool.length % divisionCount;
  const capacity = Array.from({ length: divisionCount }, (_, i) =>
    i < remainder ? base + 1 : base,
  );

  const buckets: DraftEntry[][] = serpentine(pool, capacity);
  refineBalance(buckets);

  return buckets.map((bucket, i) => ({
    id: divisionIdFor(i),
    label: options.labels?.[i] ?? `Division ${divisionIdFor(i).toUpperCase()}`,
    // Strongest first within a division, so the file reads like a seed list.
    playerIds: bucket
      .sort((a, b) => b.rating - a.rating || a.playerId.localeCompare(b.playerId))
      .map((e) => e.playerId),
  }));
}

/** `0` → "a", `1` → "b", … `25` → "z", then "aa", "ab", … */
function divisionIdFor(index: number): DivisionId {
  let id = "";
  let n = index;
  do {
    id = String.fromCharCode(97 + (n % 26)) + id;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return id;
}

/**
 * Serpentine allocation: deal the sorted pool in alternating directions so the
 * division that picks last in one round picks first in the next. Divisions that
 * have reached capacity are skipped, which is what keeps uneven sizes working.
 */
function serpentine(
  pool: readonly DraftEntry[],
  capacity: readonly number[],
): DraftEntry[][] {
  const buckets: DraftEntry[][] = capacity.map(() => []);
  let cursor = 0;
  let forward = true;
  for (const entry of pool) {
    // Advance to the next division with room, reversing at each end.
    let guard = 0;
    while (buckets[cursor]!.length >= capacity[cursor]!) {
      cursor += forward ? 1 : -1;
      if (cursor >= buckets.length) {
        cursor = buckets.length - 1;
        forward = false;
      } else if (cursor < 0) {
        cursor = 0;
        forward = true;
      }
      if (++guard > buckets.length * 2 + 2) {
        throw new Error("Draft ran out of capacity");
      }
    }
    buckets[cursor]!.push(entry);

    // End of the row: turn around and let this division pick again.
    const next = cursor + (forward ? 1 : -1);
    if (next >= buckets.length || next < 0) {
      forward = !forward;
    } else {
      cursor = next;
    }
  }
  return buckets;
}

/** Mean rating of a bucket; `0` for an empty one (only possible if unused). */
function meanOf(bucket: readonly DraftEntry[]): number {
  if (bucket.length === 0) return 0;
  return bucket.reduce((sum, e) => sum + e.rating, 0) / bucket.length;
}

/** Spread between the strongest and weakest division average. */
function spreadOf(buckets: readonly DraftEntry[][]): number {
  const means = buckets.map(meanOf);
  return Math.max(...means) - Math.min(...means);
}

/**
 * Hill-climb on the division averages: repeatedly apply the single swap of two
 * players from different divisions that most reduces the spread, stopping when
 * no swap improves it. Sizes are preserved (a swap is one-for-one), and each
 * accepted step strictly reduces the spread, so this terminates; the iteration
 * cap is a floating-point backstop, not a policy.
 */
function refineBalance(buckets: DraftEntry[][]): void {
  if (buckets.length < 2) return;
  const EPSILON = 1e-9;
  const maxPasses = buckets.flat().length * buckets.length;

  for (let pass = 0; pass < maxPasses; pass++) {
    const current = spreadOf(buckets);
    let best: { a: number; b: number; i: number; j: number } | null = null;
    let bestSpread = current;

    for (let a = 0; a < buckets.length; a++) {
      for (let b = a + 1; b < buckets.length; b++) {
        for (let i = 0; i < buckets[a]!.length; i++) {
          for (let j = 0; j < buckets[b]!.length; j++) {
            swap(buckets, a, i, b, j);
            const candidate = spreadOf(buckets);
            swap(buckets, a, i, b, j); // undo
            if (candidate < bestSpread - EPSILON) {
              bestSpread = candidate;
              best = { a, b, i, j };
            }
          }
        }
      }
    }

    if (!best) return;
    swap(buckets, best.a, best.i, best.b, best.j);
  }
}

function swap(
  buckets: DraftEntry[][],
  a: number,
  i: number,
  b: number,
  j: number,
): void {
  const left = buckets[a]!;
  const right = buckets[b]!;
  const tmp = left[i]!;
  left[i] = right[j]!;
  right[j] = tmp;
}

/**
 * The weekly email: assemble the bulletin, then render it.
 *
 * Like the rest of `server/`, this is a *consumer* of the library. The bulletin
 * itself — what counts as last week's results, which makeups are owed, where
 * each division stands — is league logic and lives in `buildWeeklyReport`
 * (Layer 3). Everything here is presentation: two renderers, one HTML for
 * pasting into an email client, one plain text for anywhere else.
 *
 * Reach it three ways, all producing the same bulletin:
 *
 *   npm run report                     → HTML on stdout
 *   npm run report -- --format text    → plain text
 *   GET /report?session=…&week=…       → the same HTML in a browser, ready to
 *                                        select-all and paste into an email
 *
 * The HTML is written for mail clients, not browsers: one fixed-width table, no
 * flexbox, no grid, no CSS variables, no media queries, and every style
 * inlined — Outlook strips a <style> block, so nothing may depend on one.
 */
import {
  LeagueService,
  SimpleProvisionalRatingEngine,
  buildWeeklyReport,
  spotRatingsFor,
  type DivisionReport,
  type LeagueRepository,
  type ReportFixture,
  type ReportResult,
  type SessionId,
  type Standing,
  type WeeklyReport,
} from "../src/index.js";
import { resolveSession, sessionViews } from "./sessions.js";

/** The league's name, as it should appear at the top of the email. */
export const LEAGUE_NAME = "Hale One Pocket (HOP) League";

export interface ReportRequest {
  /** Session to report on. Omit for the latest session on record. */
  session?: string | null;
  /** Week to preview as "this week". Omit to infer it (see `currentWeekFor`). */
  week?: number | null;
}

/**
 * Load the league and build the bulletin for one session and week.
 *
 * The spot ratings passed in are the ones that actually govern play (they
 * re-base every block of games per player, see `spotRatingsFor`), NOT the live
 * ratings — the email must print the spot the players will really be given.
 */
export function weeklyReportFor(
  store: LeagueRepository,
  request: ReportRequest = {},
): WeeklyReport {
  const data = store.load();
  const engine = new SimpleProvisionalRatingEngine();
  const sessionId: SessionId = resolveSession(data, request.session ?? null);
  const view = sessionViews(data).find((v) => v.id === sessionId);

  const ratings = engine.calculateRatings({
    players: data.players,
    matches: data.matches,
  });
  const league = new LeagueService(data.players, ratings, data.matches);

  return buildWeeklyReport(
    league,
    {
      players: data.players,
      matches: data.matches,
      schedule: data.schedule,
      divisions: view?.divisions ?? [],
      roster: view?.players,
    },
    {
      sessionId,
      sessionLabel: view?.label,
      week: request.week ?? undefined,
      spotRatings: spotRatingsFor(engine, data.players, data.matches),
    },
  );
}

// --- Shared phrasing -------------------------------------------------------

/** "Dave Stem 3–1 Jeff Shelquist", winner first is NOT assumed — seats are. */
function scoreLine(r: ReportResult): string {
  return `${r.home.name} ${r.score.home}–${r.score.away} ${r.away.name}`;
}

/**
 * Per-game ball counts, home-away, e.g. "8-4, 6-8, 8-0". A negative total is
 * parenthesised — in one pocket a foul costs a ball, so a loser can finish
 * below zero, and "9--2" is not a score anyone can read.
 */
function gameLine(r: ReportResult): string {
  if (r.forfeit) return "forfeit";
  const balls = (n: number): string => (n < 0 ? `(${n})` : String(n));
  return r.games
    .map((g) => `${balls(g.homeBalls)}-${balls(g.awayBalls)}`)
    .join(", ");
}

function fixtureLine(f: ReportFixture): string {
  return `${f.home.name} vs ${f.away.name}`;
}

/** Explains the per-game ball column, which is otherwise easy to misread. */
const GAMES_LEGEND =
  "Games are balls pocketed each game, home-away; the winner is the side " +
  "that reached their spot.";

function pct(value: number): string {
  return (value * 100).toFixed(0) + "%";
}

/** True when the bulletin has nothing at all to say for a section. */
function totalOf(
  report: WeeklyReport,
  pick: (d: DivisionReport) => readonly unknown[],
): number {
  return report.divisions.reduce((sum, d) => sum + pick(d).length, 0);
}

// --- HTML ------------------------------------------------------------------

const TEXT = "#1a1c20";
const MUTED = "#666b74";
const BORDER = "#dfe2e8";
const PANEL = "#f5f6f8";
const ACCENT = "#2f6feb";

const TABLE =
  `width:100%;border-collapse:collapse;font-size:14px;color:${TEXT};` +
  `font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;`;
const CELL = `padding:6px 8px;border-bottom:1px solid ${BORDER};`;
const TH =
  CELL +
  `color:${MUTED};font-size:11px;text-transform:uppercase;` +
  `letter-spacing:0.04em;font-weight:600;text-align:left;`;
const TH_NUM = TH.replace("text-align:left;", "text-align:right;");
const TD = CELL + "text-align:left;";
const TD_NUM = CELL + "text-align:right;";
const H2 = `margin:28px 0 6px;font-size:17px;color:${TEXT};`;
const H3 = `margin:18px 0 6px;font-size:13px;color:${MUTED};` +
  `text-transform:uppercase;letter-spacing:0.05em;`;
const NOTE = `margin:6px 0;font-size:13px;color:${MUTED};`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Per-game ball counts with the winning side in bold. Bolding is what makes the
 * column readable: with an 8-7 spot a game can end "7-7" — the away player
 * reaching their 7 while the home player fell one short of their 8 — and
 * nothing but the spot says who took it.
 */
function gameCellHtml(r: ReportResult): string {
  if (r.forfeit) return "forfeit";
  const balls = (n: number): string => (n < 0 ? `(${n})` : String(n));
  return r.games
    .map((g) => {
      const home = balls(g.homeBalls);
      const away = balls(g.awayBalls);
      return g.winner === r.home.id
        ? `<strong style="color:${TEXT}">${home}</strong>-${away}`
        : `${home}-<strong style="color:${TEXT}">${away}</strong>`;
    })
    .join(", ");
}

/** A result's score cell, with the winner's name in bold. */
function scoreCellHtml(r: ReportResult): string {
  const home = escapeHtml(r.home.name);
  const away = escapeHtml(r.away.name);
  const homeWon = r.winner.id === r.home.id;
  return (
    (homeWon ? `<strong>${home}</strong>` : home) +
    ` <span style="color:${MUTED}">${r.score.home}–${r.score.away}</span> ` +
    (homeWon ? away : `<strong>${away}</strong>`)
  );
}

function resultsTableHtml(results: readonly ReportResult[], showWeek = false): string {
  const head =
    `<tr>${showWeek ? `<th style="${TH}">Wk</th>` : ""}` +
    `<th style="${TH}">Result</th><th style="${TH}">Spot</th>` +
    `<th style="${TH}">Games (balls)</th></tr>`;
  const rows = results
    .map(
      (r) =>
        `<tr>${showWeek ? `<td style="${TD}">${r.week}</td>` : ""}` +
        `<td style="${TD}">${scoreCellHtml(r)}</td>` +
        `<td style="${TD}">${escapeHtml(r.formattedSpot)}</td>` +
        `<td style="${TD}color:${MUTED}">${gameCellHtml(r)}</td></tr>`,
    )
    .join("");
  return `<table style="${TABLE}" cellpadding="0" cellspacing="0">${head}${rows}</table>`;
}

function fixturesTableHtml(
  fixtures: readonly ReportFixture[],
  showWeek: boolean,
): string {
  const head =
    `<tr>${showWeek ? `<th style="${TH}">Wk</th>` : ""}` +
    `<th style="${TH}">Match</th><th style="${TH}">Spot</th>` +
    `<th style="${TH}">Status</th></tr>`;
  const rows = fixtures
    .map((f) => {
      const status = f.played
        ? `<span style="color:${ACCENT}">played</span>`
        : "";
      return (
        `<tr>${showWeek ? `<td style="${TD}">${f.week}</td>` : ""}` +
        `<td style="${TD}">${escapeHtml(fixtureLine(f))}</td>` +
        `<td style="${TD}">${escapeHtml(f.formattedSpot ?? "—")}</td>` +
        `<td style="${TD}font-size:12px">${status}</td></tr>`
      );
    })
    .join("");
  return `<table style="${TABLE}" cellpadding="0" cellspacing="0">${head}${rows}</table>`;
}

function standingsTableHtml(rows: readonly Standing[]): string {
  const head =
    `<tr><th style="${TH}">#</th><th style="${TH}">Player</th>` +
    `<th style="${TH_NUM}">W</th><th style="${TH_NUM}">L</th>` +
    `<th style="${TH_NUM}">Win%</th>` +
    `<th style="${TH_NUM}">Ball%</th></tr>`;
  const body = rows
    .map(
      (s) =>
        `<tr><td style="${TD}color:${MUTED}">${s.rank}</td>` +
        `<td style="${TD}">${escapeHtml(s.name)}</td>` +
        `<td style="${TD_NUM}">${s.gamesWon}</td>` +
        `<td style="${TD_NUM}">${s.gamesLost}</td>` +
        `<td style="${TD_NUM}">${pct(s.winPct)}</td>` +
        `<td style="${TD_NUM}color:${MUTED}">${pct(s.ballPct)}</td></tr>`,
    )
    .join("");
  return `<table style="${TABLE}" cellpadding="0" cellspacing="0">${head}${body}</table>`;
}

/**
 * The whole bulletin as one self-contained HTML document. Select all, copy,
 * paste into the mail client — the inline styles survive the trip.
 */
export function renderReportHtml(report: WeeklyReport): string {
  const parts: string[] = [];
  const lastWeek = report.lastWeek;

  parts.push(
    `<h1 style="margin:0 0 2px;font-size:20px;color:${TEXT}">${escapeHtml(LEAGUE_NAME)}</h1>`,
    `<p style="${NOTE}">${escapeHtml(report.sessionLabel)} — week ${report.week}</p>`,
  );

  // 1. Last week's results.
  parts.push(
    `<h2 style="${H2}">${lastWeek === null ? "Results" : `Week ${lastWeek} results`}</h2>`,
  );
  if (lastWeek === null) {
    parts.push(`<p style="${NOTE}">The season starts this week — no results yet.</p>`);
  } else if (totalOf(report, (d) => d.results) === 0) {
    parts.push(`<p style="${NOTE}">No results recorded for week ${lastWeek}.</p>`);
  } else {
    for (const d of report.divisions) {
      if (d.results.length === 0) continue;
      parts.push(
        `<h3 style="${H3}">${escapeHtml(d.label)}</h3>`,
        resultsTableHtml(d.results),
      );
    }
    parts.push(`<p style="${NOTE}">${escapeHtml(GAMES_LEGEND)}</p>`);
  }

  // Earlier weeks that landed in the log after play moved on — reported
  // separately so the table above stays honest about which week each result
  // belongs to, and so a settled makeup still gets announced once.
  if (totalOf(report, (d) => d.lateResults) > 0) {
    parts.push(
      `<h2 style="${H2}">Makeups &amp; late entries</h2>`,
      `<p style="${NOTE}">Matches from before week ${lastWeek} that were ` +
        `entered after week ${lastWeek} started.</p>`,
    );
    for (const d of report.divisions) {
      if (d.lateResults.length === 0) continue;
      parts.push(
        `<h3 style="${H3}">${escapeHtml(d.label)}</h3>`,
        resultsTableHtml(d.lateResults, true),
      );
    }
  }

  // 2. This week's schedule.
  parts.push(`<h2 style="${H2}">Week ${report.week} schedule</h2>`);
  if (totalOf(report, (d) => d.upcoming) === 0) {
    parts.push(`<p style="${NOTE}">Nothing scheduled for week ${report.week}.</p>`);
  } else {
    for (const d of report.divisions) {
      if (d.upcoming.length === 0 && d.byes.length === 0) continue;
      parts.push(`<h3 style="${H3}">${escapeHtml(d.label)}</h3>`);
      if (d.upcoming.length > 0) {
        parts.push(fixturesTableHtml(d.upcoming, false));
      }
      if (d.byes.length > 0) {
        parts.push(
          `<p style="${NOTE}">Bye: ${escapeHtml(d.byes.map((b) => b.name).join(", "))}</p>`,
        );
      }
    }
    parts.push(
      `<p style="${NOTE}">Spots are current as of this email. A player's spot ` +
        `re-bases once they finish another block of games, so a spot can move ` +
        `before a later week is played.</p>`,
    );
  }

  // 3. Makeups owed.
  parts.push(`<h2 style="${H2}">Makeups needed</h2>`);
  if (report.makeupCount === 0) {
    parts.push(`<p style="${NOTE}">None — every scheduled match is in the books.</p>`);
  } else {
    for (const d of report.divisions) {
      if (d.makeups.length === 0) continue;
      parts.push(
        `<h3 style="${H3}">${escapeHtml(d.label)}</h3>`,
        fixturesTableHtml(d.makeups, true),
      );
    }
  }

  // 4. Standings.
  parts.push(`<h2 style="${H2}">Standings</h2>`);
  for (const d of report.divisions) {
    if (d.standings.length === 0) continue;
    parts.push(
      `<h3 style="${H3}">${escapeHtml(d.label)}</h3>`,
      standingsTableHtml(d.standings),
    );
  }
  parts.push(
    `<p style="${NOTE}">Standings are games won and lost within ` +
      `${escapeHtml(report.sessionLabel)}. Ties on Win% are broken by Ball% — ` +
      `the share of the balls you needed that you actually pocketed.</p>`,
  );

  const body = parts.join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(LEAGUE_NAME)} — ${escapeHtml(report.sessionLabel)} week ${report.week}</title>
</head>
<body style="margin:0;padding:0;background:${PANEL};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:680px;max-width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;">
<tr><td style="padding:24px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};line-height:1.5;">
${body}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

// --- Plain text ------------------------------------------------------------

function underline(title: string, char = "="): string {
  return `${title}\n${char.repeat(title.length)}`;
}

function textResults(results: readonly ReportResult[], showWeek = false): string[] {
  return results.map((r) => {
    const prefix = showWeek ? `wk${r.week}  ` : "";
    const games = gameLine(r);
    return `  ${prefix}${scoreLine(r)}  [${r.formattedSpot}]  ${games}`;
  });
}

function textFixtures(
  fixtures: readonly ReportFixture[],
  showWeek: boolean,
): string[] {
  return fixtures.map((f) => {
    const prefix = showWeek ? `wk${f.week}  ` : "";
    const spot = f.formattedSpot ? `  [${f.formattedSpot}]` : "";
    const played = f.played ? "  (already played)" : "";
    return `  ${prefix}${fixtureLine(f)}${spot}${played}`;
  });
}

function textStandings(rows: readonly Standing[]): string[] {
  const width = Math.max(6, ...rows.map((s) => s.name.length));
  const header =
    `  ${"#".padStart(2)}  ${"Player".padEnd(width)}   W   L   Win%  Ball%`;
  return [
    header,
    ...rows.map(
      (s) =>
        `  ${String(s.rank).padStart(2)}  ${s.name.padEnd(width)}` +
        `  ${String(s.gamesWon).padStart(2)}  ${String(s.gamesLost).padStart(2)}` +
        `  ${pct(s.winPct).padStart(5)}  ${pct(s.ballPct).padStart(5)}`,
    ),
  ];
}

/** The same bulletin as plain text, for a text email or a printout. */
export function renderReportText(report: WeeklyReport): string {
  const out: string[] = [];
  const lastWeek = report.lastWeek;

  out.push(underline(`${LEAGUE_NAME} — ${report.sessionLabel}, week ${report.week}`));
  out.push("");

  out.push(underline(lastWeek === null ? "RESULTS" : `WEEK ${lastWeek} RESULTS`, "-"));
  if (lastWeek === null) {
    out.push("  The season starts this week — no results yet.");
  } else if (totalOf(report, (d) => d.results) === 0) {
    out.push(`  No results recorded for week ${lastWeek}.`);
  } else {
    for (const d of report.divisions) {
      if (d.results.length === 0) continue;
      out.push(`${d.label}:`, ...textResults(d.results));
    }
    out.push("", `  ${GAMES_LEGEND}`);
  }
  out.push("");

  if (totalOf(report, (d) => d.lateResults) > 0) {
    out.push(
      underline("MAKEUPS & LATE ENTRIES", "-"),
      `  (from before week ${lastWeek}, entered after week ${lastWeek} started)`,
    );
    for (const d of report.divisions) {
      if (d.lateResults.length === 0) continue;
      out.push(`${d.label}:`, ...textResults(d.lateResults, true));
    }
    out.push("");
  }

  out.push(underline(`WEEK ${report.week} SCHEDULE`, "-"));
  if (totalOf(report, (d) => d.upcoming) === 0) {
    out.push(`  Nothing scheduled for week ${report.week}.`);
  } else {
    for (const d of report.divisions) {
      if (d.upcoming.length === 0 && d.byes.length === 0) continue;
      out.push(`${d.label}:`, ...textFixtures(d.upcoming, false));
      if (d.byes.length > 0) {
        out.push(`  Bye: ${d.byes.map((b) => b.name).join(", ")}`);
      }
    }
    out.push(
      "  Spots are current as of this email; a player's spot re-bases once",
      "  they finish another block of games.",
    );
  }
  out.push("");

  out.push(underline("MAKEUPS NEEDED", "-"));
  if (report.makeupCount === 0) {
    out.push("  None — every scheduled match is in the books.");
  } else {
    for (const d of report.divisions) {
      if (d.makeups.length === 0) continue;
      out.push(`${d.label}:`, ...textFixtures(d.makeups, true));
    }
  }
  out.push("");

  out.push(underline("STANDINGS", "-"));
  for (const d of report.divisions) {
    if (d.standings.length === 0) continue;
    out.push(`${d.label}:`, ...textStandings(d.standings), "");
  }
  out.push(
    `Standings cover ${report.sessionLabel} only. Ties on Win% break on Ball% —`,
    "the share of the balls you needed that you actually pocketed.",
  );

  return out.join("\n") + "\n";
}

/**
 * Generate the weekly email from the command line.
 *
 *   npm run report                                → HTML on stdout
 *   npm run report -- --format text               → plain text
 *   npm run report -- --week 4                    → preview a specific week
 *   npm run report -- --session fall-2026         → a specific session
 *   npm run report -- --out week3.html            → write to a file instead
 *
 * With no arguments it reports on the latest session on record and infers the
 * week from the game log (see `currentWeekFor`): the week being played now, so
 * "last week's results" is the week just finished.
 *
 * Data dir: $LEAGUE_DATA_DIR, else server/data/season-2026 — the same default
 * the web app uses, so both read the same league.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CsvLeagueStore } from "../src/index.js";
import { renderReportHtml, renderReportText, weeklyReportFor } from "./report.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env.LEAGUE_DATA_DIR ?? join(HERE, "data", "season-2026");

interface Args {
  session: string | null;
  week: number | null;
  format: "html" | "text";
  out: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { session: null, week: null, format: "html", out: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    const need = (): string => {
      if (value === undefined) throw new Error(`${flag} needs a value`);
      i++;
      return value;
    };
    switch (flag) {
      case "--session":
      case "-s":
        args.session = need();
        break;
      case "--week":
      case "-w": {
        const week = Number(need());
        if (!Number.isInteger(week) || week < 1) {
          throw new Error(`--week must be a positive integer, got ${week}`);
        }
        args.week = week;
        break;
      }
      case "--format":
      case "-f": {
        const format = need();
        if (format !== "html" && format !== "text") {
          throw new Error(`--format must be "html" or "text", got ${format}`);
        }
        args.format = format;
        break;
      }
      case "--out":
      case "-o":
        args.out = need();
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: npm run report -- [options]",
            "",
            "  -s, --session <id>     session to report on (default: latest on record)",
            "  -w, --week <n>         week to preview (default: inferred from results)",
            "  -f, --format <fmt>     html (default) or text",
            "  -o, --out <file>       write to a file instead of stdout",
          ].join("\n"),
        );
        process.exit(0);
      default:
        throw new Error(`Unknown argument "${flag}" (try --help)`);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const store = new CsvLeagueStore(DATA_DIR);
const report = weeklyReportFor(store, { session: args.session, week: args.week });
const rendered =
  args.format === "html" ? renderReportHtml(report) : renderReportText(report);

if (args.out) {
  writeFileSync(args.out, rendered, "utf8");
  console.error(
    `Wrote ${args.format} report for ${report.sessionLabel}, week ${report.week} → ${args.out}`,
  );
} else {
  process.stdout.write(rendered);
}

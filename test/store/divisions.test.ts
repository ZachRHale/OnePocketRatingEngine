import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CsvLeagueStore } from "../../src/index.js";

/**
 * Exercises divisions.csv: the optional, read-only third file that names the
 * player groups within a session. The behavior that matters most is that a
 * session drafted but not yet played still loads — that is what makes a
 * pre-season standings view possible.
 */
describe("CsvLeagueStore divisions", () => {
  let dir: string;

  const PLAYERS =
    [
      "id,fargo,name",
      "a,600,Ada",
      "b,550,Ben",
      "c,500,Cal",
      "d,450,Dot",
    ].join("\n") + "\n";
  const GAMES_HEADER =
    "session,matchId,week,home,away,winner,loserBalls,forfeit";

  const writeDivisions = (body: string[]) =>
    writeFileSync(
      join(dir, "divisions.csv"),
      ["session,division,player", ...body].join("\n") + "\n",
      "utf8",
    );

  const sessionNamed = (id: string) =>
    new CsvLeagueStore(dir).load().sessions.find((s) => s.id === id);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "league-divisions-"));
    writeFileSync(join(dir, "players.csv"), PLAYERS, "utf8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads every session as undivided when the file is absent", () => {
    writeFileSync(
      join(dir, "games.csv"),
      [GAMES_HEADER, "s1,s1-w1-1,1,a,b,a,2,0"].join("\n") + "\n",
      "utf8",
    );
    expect(sessionNamed("s1")!.divisions).toEqual([]);
  });

  it("attaches divisions to a session, in file order", () => {
    writeDivisions(["s1,a,a", "s1,a,c", "s1,b,b", "s1,b,d"]);
    const divisions = sessionNamed("s1")!.divisions;
    expect(divisions.map((d) => d.id)).toEqual(["a", "b"]);
    expect(divisions[0]!.playerIds).toEqual(["a", "c"]);
    expect(divisions[1]!.playerIds).toEqual(["b", "d"]);
  });

  it("loads a session that exists only in divisions.csv, with no games", () => {
    // The pre-season case: drafted, nothing played.
    writeDivisions(["spring,a,a", "spring,b,b"]);
    const session = sessionNamed("spring")!;
    expect(session).toBeDefined();
    expect(session.weeks).toBe(0);
    expect(session.playerIds).toEqual(["a", "b"]);
    expect(session.divisions).toHaveLength(2);
  });

  it("orders played sessions first, then draft-only sessions", () => {
    writeFileSync(
      join(dir, "games.csv"),
      [GAMES_HEADER, "played,played-w1-1,1,a,b,a,2,0"].join("\n") + "\n",
      "utf8",
    );
    writeDivisions(["upcoming,a,a", "upcoming,b,b"]);
    const { sessions } = new CsvLeagueStore(dir).load();
    expect(sessions.map((s) => s.id)).toEqual(["played", "upcoming"]);
    expect(sessions.map((s) => s.index)).toEqual([1, 2]);
  });

  it("takes the session roster as divisions plus anyone who played", () => {
    // `d` is in no division but shows up in the log; the roster keeps them.
    writeFileSync(
      join(dir, "games.csv"),
      [GAMES_HEADER, "s1,s1-w1-1,1,c,d,c,2,0"].join("\n") + "\n",
      "utf8",
    );
    writeDivisions(["s1,a,a", "s1,b,b", "s1,b,c"]);
    expect(sessionNamed("s1")!.playerIds).toEqual(["a", "b", "c", "d"]);
  });

  it("titles a division from its id", () => {
    writeDivisions(["s1,a,a", "s1,b,b"]);
    expect(sessionNamed("s1")!.divisions.map((d) => d.label)).toEqual([
      "Division A",
      "Division B",
    ]);
  });

  it("honors an optional label column", () => {
    writeFileSync(
      join(dir, "divisions.csv"),
      [
        "session,division,player,label",
        "s1,a,a,Sharks",
        "s1,a,c,Sharks",
        "s1,b,b,",
      ].join("\n") + "\n",
      "utf8",
    );
    expect(sessionNamed("s1")!.divisions.map((d) => d.label)).toEqual([
      "Sharks",
      "Division B",
    ]);
  });

  it("keeps divisions independent across sessions (they are re-drafted)", () => {
    writeDivisions(["s1,a,a", "s1,b,b", "s2,a,b", "s2,b,a"]);
    const { sessions } = new CsvLeagueStore(dir).load();
    const s1 = sessions.find((s) => s.id === "s1")!;
    const s2 = sessions.find((s) => s.id === "s2")!;
    expect(s1.divisions[0]!.playerIds).toEqual(["a"]);
    expect(s2.divisions[0]!.playerIds).toEqual(["b"]);
  });

  describe("rejects a malformed draft", () => {
    it("rejects an unknown player id", () => {
      writeDivisions(["s1,a,ghost"]);
      expect(() => new CsvLeagueStore(dir).load()).toThrow(
        /Unknown player "ghost"/,
      );
    });

    it("rejects a player in two divisions of one session", () => {
      writeDivisions(["s1,a,a", "s1,b,a"]);
      expect(() => new CsvLeagueStore(dir).load()).toThrow(
        /in two divisions of session "s1"/,
      );
    });

    it("rejects a player listed twice in the same division", () => {
      writeDivisions(["s1,a,a", "s1,a,a"]);
      expect(() => new CsvLeagueStore(dir).load()).toThrow(/listed twice/);
    });

    it("rejects a missing required column", () => {
      writeFileSync(
        join(dir, "divisions.csv"),
        ["session,player", "s1,a"].join("\n") + "\n",
        "utf8",
      );
      expect(() => new CsvLeagueStore(dir).load()).toThrow(/division/);
    });
  });
});

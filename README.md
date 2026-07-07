# league-calculator

A rating system for a **one-pocket billiards league**, built as a small
TypeScript library. The design keeps the rating algorithm out of the data model
and the league logic so the algorithm can evolve without rewriting the app.

## One-pocket rules encoded here

- Every match is a **race to 3 games** (`RACE_TO_GAMES`).
- The handicap is a **ball spot applied to every game**, _not_ the number of
  games needed to win. A spot like `8-7` means the two players must pocket 8 and
  7 balls respectively to win each game. The same spot is used for every game in
  the match.
- Each player has a **Fargo rating** (seed only) and a **League Rating** (the
  authoritative rating once play begins), plus **confidence**, **provisional**
  status, and a **trend**.

## Architecture — three layers

The whole point is clean separation so the rating system can keep improving.

| Layer | Folder | Responsibility | Depends on |
| ----- | ------ | -------------- | ---------- |
| 1. Raw Match Data | [`src/domain/`](src/domain/) | Immutable facts: `Player`, `Match`, `Game`, `BallSpot`. Types only. | nothing |
| 2. Rating Engine | [`src/rating/`](src/rating/) | Consumes match history, produces ratings, behind the swappable `RatingEngine` interface. | Layer 1 |
| 3. League Logic | [`src/league/`](src/league/) | Asks questions of computed ratings (standings, tonight's ball spot). **Never calculates ratings.** | Layers 1 & 2 |

The seam is the [`RatingEngine`](src/rating/RatingEngine.ts) interface. Swap in a
smarter engine, run several side by side to compare them, or recompute every
rating from history — none of that touches Layer 1 or Layer 3.

## Install & build

```bash
npm install
npm run build     # emits dist/ (compiled JS + .d.ts types)
npm test          # run the unit tests once
npm run typecheck
```

## Usage

```ts
import {
  seedPlayer,
  SimpleProvisionalRatingEngine,
  LeagueService,
  type Match,
} from "league-calculator";

// Layer 1: seed players (League Rating starts equal to Fargo).
const players = [seedPlayer("alice", "Alice", 506), seedPlayer("bob", "Bob", 450)];
const matches: Match[] = [/* ...recorded matches with per-game results... */];

// Layer 2: compute ratings from history.
const engine = new SimpleProvisionalRatingEngine();
const ratings = engine.calculateRatings({ players, matches });

// Layer 3: run the league off those ratings.
const league = new LeagueService(players, ratings);
league.standings();                 // ranked table
league.ballSpotFor("alice", "bob"); // tonight's spot, e.g. { home: 8, away: 7 }
league.isProvisional("bob");
```

## The current rating engine

`SimpleProvisionalRatingEngine` is a deliberately simple first pass: per-game
Elo with the ball spot folded into the win expectation **and the margin of
victory scaling each game's swing**. It uses far more than "who won the match":

- each individual game outcome, not just the match result;
- the handicap (ball spot) in effect, folded into the win expectation;
- how decisive each game was — a shutout moves ratings more than a hill-hill
  game, measured by how many balls the loser made vs. their target (tunable via
  `marginWeight`, or set to `0` for pure win/loss);
- confidence, provisional status, and trend.

It intentionally does **not** yet use strength of schedule or expected-vs-actual
streak analysis. Those are the natural next steps and are marked as extension
points in
[`SimpleProvisionalRatingEngine.ts`](src/rating/SimpleProvisionalRatingEngine.ts).
Because everything sits behind the `RatingEngine` interface, a more
sophisticated engine can be dropped in later with no changes to the data model
or league logic.

## Future directions the architecture supports

- Compare multiple rating algorithms on the same history.
- Recalculate every rating from scratch (the engine is a pure function of input).
- Simulate and score handicap tables for fairness.
- Predict win probability; detect under/over-rated players.
- Statistics dashboards built on the immutable game log.
```

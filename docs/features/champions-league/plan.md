# Add Champions League + Make Adding Leagues Easy

## Context

No Premier League games for ~a week. Champions League has active Polymarket markets (next matches March 10-11). The system is already league-agnostic in its prediction logic — just need to wire up the config and team name matching.

## Research Findings

- **Polymarket UCL tag ID**: `100977` (label: "UCL")
- **Polymarket series slug**: `ucl-2025` (prefix match with `ucl`)
- **API-Football league ID**: `2` (UEFA Champions League)
- The prediction engine, feature extraction, and stats gathering are all fully league-agnostic — no code changes needed there
- The current `filterBySeriesSlug` uses `startsWith` — so `polymarketSeriesSlug: "ucl"` will match `seriesSlug: "ucl-2025"`. No code change needed.

### Current Polymarket UCL R16 Event Titles (from Gamma API, March 2026)

These are the **exact** event title strings returned by the Gamma API for upcoming UCL matches:

1. `"Club Atlético de Madrid vs. Tottenham Hotspur FC"`
2. `"Paris Saint-Germain FC vs. Chelsea FC"`
3. `"Galatasaray SK vs. Liverpool FC"`
4. `"Newcastle United FC vs. FC Barcelona"`
5. `"FK Bodø/Glimt vs. Sporting CP"`
6. `"Real Madrid CF vs. Manchester City FC"`
7. `"Atalanta BC vs. FC Bayern München"`
8. `"Bayer 04 Leverkusen vs. Arsenal FC"`

All have `seriesSlug: "ucl-2025"`.

### Current Polymarket EPL Event Titles (from Gamma API, March 2026)

1. `"Tottenham Hotspur FC vs. Crystal Palace FC"`

## Files to Modify

1. `src/orchestrator/config.ts`
2. `src/domain/services/team-names.ts`
3. `src/scripts/test-pipeline.ts`
4. `tests/unit/domain/services/team-names.test.ts`

---

## ~~Task 1: Add league catalog to config~~ [DONE]

**File**: `src/orchestrator/config.ts`

Replace the inline `DEFAULT_LEAGUES` array with a `LEAGUE_CATALOG` object containing pre-configured leagues, then define `DEFAULT_LEAGUES` by referencing catalog entries. This makes adding a new league a one-liner.

### Changes

Add `LEAGUE_CATALOG` before `DEFAULT_LEAGUES`:

```typescript
export const LEAGUE_CATALOG = {
  premierLeague: {
    id: 39,
    name: "Premier League",
    country: "England",
    polymarketTagIds: [82],
    polymarketSeriesSlug: "premier-league",
  },
  championsLeague: {
    id: 2,
    name: "Champions League",
    country: "World",
    polymarketTagIds: [100977],
    polymarketSeriesSlug: "ucl",
  },
  laLiga: {
    id: 140,
    name: "La Liga",
    country: "Spain",
    polymarketTagIds: [306],
    polymarketSeriesSlug: "la-liga",
  },
  serieA: {
    id: 135,
    name: "Serie A",
    country: "Italy",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "serie-a",
  },
  bundesliga: {
    id: 78,
    name: "Bundesliga",
    country: "Germany",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "bundesliga",
  },
  ligue1: {
    id: 61,
    name: "Ligue 1",
    country: "France",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "ligue-1",
  },
} as const satisfies Record<string, LeagueConfig>;
```

Replace `DEFAULT_LEAGUES` with:

```typescript
export const DEFAULT_LEAGUES: LeagueConfig[] = [
  LEAGUE_CATALOG.premierLeague,
  LEAGUE_CATALOG.championsLeague,
];
```

### Rationale

To add a new league in the future: add it to the catalog, then add one line to `DEFAULT_LEAGUES`. No need to duplicate config objects across files.

---

## ~~Task 2: Add Champions League team name aliases~~ [DONE]

**File**: `src/domain/services/team-names.ts`

Add team name groups for major CL clubs that have common abbreviations or alternate names between Polymarket and API-Football.

### Changes

Append to the `TEAM_NAME_GROUPS` array:

```typescript
// Champions League clubs with common aliases
["paris saint-germain", "paris saint germain", "paris sg", "psg"],
["bayern munich", "bayern münchen", "bayern munchen", "bayern"],
["real madrid", "real madrid cf"],
["fc barcelona", "barcelona", "barca"],
["atletico madrid", "atletico de madrid", "club atletico de madrid", "atletico"],
["rb leipzig", "rasenballsport leipzig", "leipzig"],
["bayer leverkusen", "bayer 04 leverkusen", "leverkusen"],
["juventus", "juventus fc"],
["galatasaray", "galatasaray sk"],
["sporting cp", "sporting lisbon", "sporting"],
["celtic", "celtic fc"],
["club brugge", "club bruges"],
["red bull salzburg", "fc salzburg", "salzburg"],
["shakhtar donetsk", "shakhtar"],
["atalanta", "atalanta bc"],
["bodø/glimt", "bodo/glimt", "bodo glimt", "fk bodø/glimt"],
```

### Notes

- Some clubs (Inter Milan, AC Milan, Borussia Dortmund) already have entries — no duplicates needed.
- The `SUFFIX_PATTERN` regex already strips `fc`, `cf`, `rb`, `sc` etc., so some of these aliases are belt-and-suspenders, but explicit aliases are safer for matching accuracy.
- `"Atalanta BC"` and `"FK Bodø/Glimt"` added vs the original plan — these appear in the actual Polymarket event titles.
- **Important**: The `SUFFIX_PATTERN` strips `bc` (via `bsc`?) — need to verify. If not, the `"atalanta bc"` alias is required. Same for `"fk"` — it is NOT in the current suffix pattern, so the Bodø/Glimt alias group is essential.

---

## ~~Task 3: Add team name matching tests for every active market club~~ [DONE]

**File**: `tests/unit/domain/services/team-names.test.ts`

For **every club currently appearing on the Polymarket soccer markets page**, there must be a `teamNamesMatch` test that verifies the **exact Polymarket event title name** matches the **API-Football fixture name**. This is the safety net that ensures no matches are silently missed.

### Already covered by existing tests

These clubs already have explicit `teamNamesMatch` tests:

| Polymarket Name | API-Football Name | Test Location |
|---|---|---|
| `Arsenal FC` | `Arsenal` | line 64 |
| `Tottenham Hotspur FC` | `Tottenham` | line 68 |
| `Crystal Palace FC` | `Crystal Palace` | line 72 |
| `Manchester City FC` | `Manchester City` | line 100 |
| `Fulham FC` | `Fulham` | line 104 |
| `Brentford FC` | `Brentford` | line 108 |
| `Wolverhampton Wanderers FC` | `Wolves` / `Wolverhampton` | lines 112-122 |
| `Nottingham Forest FC` | `Nottingham Forest` | line 88 |
| `Sheffield United FC` | `Sheffield United` | line 92 |

### Tests to add — UCL R16 clubs

Every test below uses the **exact Polymarket event title name** (left side) and the **expected API-Football name** (right side). The API-Football names must be verified at implementation time by running the test pipeline or checking the API directly — the names below are best guesses based on API-Football conventions.

```typescript
describe("Champions League team name matching", () => {
  // ── UCL R16 matches (March 2026, from Gamma API) ──

  test("matches Club Atlético de Madrid from Polymarket to Atletico Madrid from API-Football", () => {
    expect(teamNamesMatch("Club Atlético de Madrid", "Atletico Madrid")).toBe(true);
  });

  test("matches Paris Saint-Germain FC from Polymarket to Paris Saint Germain from API-Football", () => {
    expect(teamNamesMatch("Paris Saint-Germain FC", "Paris Saint Germain")).toBe(true);
  });

  test("matches Chelsea FC from Polymarket to Chelsea from API-Football", () => {
    expect(teamNamesMatch("Chelsea FC", "Chelsea")).toBe(true);
  });

  test("matches Galatasaray SK from Polymarket to Galatasaray from API-Football", () => {
    expect(teamNamesMatch("Galatasaray SK", "Galatasaray")).toBe(true);
  });

  test("matches Liverpool FC from Polymarket to Liverpool from API-Football", () => {
    expect(teamNamesMatch("Liverpool FC", "Liverpool")).toBe(true);
  });

  test("matches Newcastle United FC from Polymarket to Newcastle United from API-Football", () => {
    expect(teamNamesMatch("Newcastle United FC", "Newcastle United")).toBe(true);
  });

  test("matches FC Barcelona from Polymarket to Barcelona from API-Football", () => {
    expect(teamNamesMatch("FC Barcelona", "Barcelona")).toBe(true);
  });

  test("matches FK Bodø/Glimt from Polymarket to Bodo/Glimt from API-Football", () => {
    expect(teamNamesMatch("FK Bodø/Glimt", "Bodo/Glimt")).toBe(true);
  });

  test("matches Sporting CP from Polymarket to Sporting CP from API-Football", () => {
    expect(teamNamesMatch("Sporting CP", "Sporting CP")).toBe(true);
  });

  test("matches Real Madrid CF from Polymarket to Real Madrid from API-Football", () => {
    expect(teamNamesMatch("Real Madrid CF", "Real Madrid")).toBe(true);
  });

  test("matches Atalanta BC from Polymarket to Atalanta from API-Football", () => {
    expect(teamNamesMatch("Atalanta BC", "Atalanta")).toBe(true);
  });

  test("matches FC Bayern München from Polymarket to Bayern Munich from API-Football", () => {
    expect(teamNamesMatch("FC Bayern München", "Bayern Munich")).toBe(true);
  });

  test("matches Bayer 04 Leverkusen from Polymarket to Bayer Leverkusen from API-Football", () => {
    expect(teamNamesMatch("Bayer 04 Leverkusen", "Bayer Leverkusen")).toBe(true);
  });
});
```

### Tricky cases to watch out for

| Polymarket Name | Challenge | Solution |
|---|---|---|
| `Club Atlético de Madrid` | Accent character `ó`, completely different structure from "Atletico Madrid" | Alias group: `["atletico madrid", "atletico de madrid", "club atletico de madrid", "atletico"]`. The `normalizeTeamName` function strips non-word chars which will remove the accent — verify `ó` → stripped or preserved by `\w` regex. |
| `FK Bodø/Glimt` | `FK` prefix not in `SUFFIX_PATTERN`, `ø` special character, `/` slash | Alias group with explicit entries. `normalizeTeamName` strips `[^\w\s]` which removes `/` and `ø`. Need to verify this doesn't break matching. May need to add `fk` to `SUFFIX_PATTERN` or handle differently. |
| `FC Bayern München` | `ü` umlaut, `FC` prefix (stripped by suffix pattern), "München" vs "Munich" | Alias group: `["bayern munich", "bayern münchen", "bayern munchen", "bayern"]`. After `FC` strip and normalization, need `münchen` → `munich` mapping via alias. |
| `Atalanta BC` | `BC` suffix — NOT in current `SUFFIX_PATTERN` (which has `bsc` but not `bc`) | Either add `bc` to `SUFFIX_PATTERN`, or rely on alias group `["atalanta", "atalanta bc"]`. Alias is safer. |
| `Galatasaray SK` | `SK` suffix — NOT in current `SUFFIX_PATTERN` | Either add `sk` to `SUFFIX_PATTERN`, or rely on alias group `["galatasaray", "galatasaray sk"]`. |

### Implementation notes

- **Verify API-Football names**: The right-hand side names in the tests above are best guesses. Before writing the tests, run the test pipeline with UCL enabled to capture the actual API-Football team names, then use those exact strings in the tests.
- **If a test fails**: It means either (a) an alias is missing from `TEAM_NAME_GROUPS`, (b) a suffix is missing from `SUFFIX_PATTERN`, or (c) the `normalizeTeamName` regex is stripping/preserving characters unexpectedly. Fix the root cause in `team-names.ts`, don't just make the test pass.
- **Add `sk` and `bc` to `SUFFIX_PATTERN`**: Consider adding these to the regex: `/\b(fc|afc|sc|cf|sv|ssc|as|bsc|bc|vfb|vfl|rb|sk|fk)\b/gi`. This is cleaner than relying on aliases for every club that uses these suffixes. If you do this, some alias entries become redundant but that's fine — belt and suspenders.

---

## ~~Task 4: Update test pipeline leagues~~ [DONE]

**File**: `src/scripts/test-pipeline.ts`

Replace the hardcoded `LEAGUES` array with an import of `LEAGUE_CATALOG` from `src/orchestrator/config.ts`, and include Champions League.

### Changes

Replace the `LEAGUES` constant (lines 31-67) with:

```typescript
import { LEAGUE_CATALOG } from "../orchestrator/config.ts";

const LEAGUES = [
  LEAGUE_CATALOG.premierLeague,
  LEAGUE_CATALOG.championsLeague,
  LEAGUE_CATALOG.laLiga,
  LEAGUE_CATALOG.serieA,
  LEAGUE_CATALOG.bundesliga,
  LEAGUE_CATALOG.ligue1,
];
```

This eliminates the duplicated league definitions and ensures test-pipeline stays in sync with the main config.

---

## Verification

1. **Unit tests**: `bun test` — all existing tests plus new UCL matching tests must pass
2. **Smoke test market discovery**: `API_SPORTS_KEY=xxx bun run src/scripts/test-pipeline.ts` — confirm UCL events are discovered and matched
3. **Check team name matching**: verify matched vs unmatched counts in test pipeline output — all 8 UCL R16 fixtures should show up as matched, zero unmatched UCL events

## Risk Assessment

- **Low risk**: All changes are additive config/data — no logic changes to the prediction engine, betting, or settlement code
- **Serie A / Bundesliga / Ligue 1 tag IDs** (`100350`) appear to be a generic "Soccer" tag on Polymarket — these leagues rely primarily on series slug filtering, not tag filtering. This is existing behavior and not a regression.
- **Special characters** (`ó`, `ø`, `ü`, `/`) in team names are the highest-risk area — the `normalizeTeamName` regex `[^\w\s]` will strip them. This is fine as long as the aliases map the stripped form to the correct canonical name.

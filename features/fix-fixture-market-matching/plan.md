# Plan: Fix Fixture-to-Market Matching

**Date:** 2026-03-04
**Status:** Complete

---

## Overview

Markets are frequently failing to match to fixtures. The immediate trigger is the Manchester City vs Nottingham Forest match (`epl-mac-not-2026-03-04-mac`), but the root cause affects all events involving Nottingham Forest, Sheffield United, and Athletic Bilbao. Two distinct bugs are compounding: (1) team name aliases are applied asymmetrically, breaking substring-based matching, and (2) the Polymarket `gameId` field lives on the event, not on individual markets, so Tier 1 gameId-based matching never fires.

---

## Root Cause Analysis

### Bug 1: Alias asymmetry in `teamNamesMatch()` — PRIMARY

In `src/domain/services/team-names.ts`, `teamNamesMatch(polymarketName, apiFootballName)` calls `resolveTeamName` (which applies aliases) on the Polymarket name, but only `normalizeTeamName` (no alias resolution) on the API-Football name.

When the alias target is **not** a substring of the original name, the match fails:

| Alias entry | Resolved (Polymarket) | Normalized (API-Football) | Substring match? |
|---|---|---|---|
| `"nottingham forest" → "nottm forest"` | `"nottm forest"` | `"nottingham forest"` | No — "nottm" ∉ "nottingham" |
| `"sheffield united" → "sheffield utd"` | `"sheffield utd"` | `"sheffield united"` | No — "utd" ∉ "united" |
| `"athletic bilbao" → "athletic club"` | `"athletic club"` | `"athletic bilbao"` | No — "club" ∉ "bilbao" |

Trace for the reported case (Nottingham Forest):
```
resolveTeamName("Nottingham Forest FC")
  → normalizeTeamName → "nottingham forest"
  → TEAM_ALIASES["nottingham forest"] → "nottm forest"

normalizeTeamName("Nottingham Forest")
  → "nottingham forest"

"nottm forest" === "nottingham forest"           → false
"nottm forest".includes("nottingham forest")     → false
"nottingham forest".includes("nottm forest")     → false
Result: NO MATCH
```

Aliases that **do** work by accident (alias target IS a substring of the original):
- `"tottenham hotspur" → "tottenham"` — ✓ "tottenham hotspur".includes("tottenham")
- `"wolverhampton wanderers" → "wolverhampton"` — ✓ substring match
- `"west ham united" → "west ham"` — ✓ substring match
- `"inter milan" → "inter"` — ✓ substring match

### Bug 2: Event-level `gameId` not propagated to markets — SECONDARY

Live Gamma API response confirms `gameId` exists at the **event** level, not on individual markets:

```json
{
  "id": "216124",
  "gameId": 90091278,          // ← event level
  "title": "Manchester City FC vs. Nottingham Forest FC",
  "markets": [
    {
      "id": "1396101",
      "question": "Will Manchester City FC win on 2026-03-04?"
      // ← no gameId here
    }
  ]
}
```

Our `GammaEvent` type omits `gameId`, and `GammaMarket` has `gameId: string | null` which is always `null` from the API. So `matchByGameId()` in Tier 1 never finds a match — every match attempt falls through to the team-name fallback.

Note: The Polymarket `gameId` (e.g. `90091278`) is in a different ID space than API-Football fixture IDs, so even after propagation, Tier 1 won't match unless we build a cross-reference. The fix here is to **capture the data** correctly; a future mapping layer can make Tier 1 useful.

---

## Approach

### Fix 1: Symmetric alias resolution in `teamNamesMatch()`

Change `teamNamesMatch` to call `resolveTeamName` on **both** arguments instead of `normalizeTeamName` on the API-Football side. This ensures both names pass through the alias table before comparison.

```typescript
export function teamNamesMatch(polymarketName: string, apiFootballName: string): boolean {
  const resolved = resolveTeamName(polymarketName);
  const normalized = resolveTeamName(apiFootballName);  // was: normalizeTeamName

  if (resolved === normalized) return true;
  return resolved.includes(normalized) || normalized.includes(resolved);
}
```

After this fix, the Nottingham Forest case:
```
resolveTeamName("Nottingham Forest FC") → "nottm forest"
resolveTeamName("Nottingham Forest")    → "nottm forest"
"nottm forest" === "nottm forest"       → true ✓
```

### Fix 2: Propagate event-level `gameId` to markets

1. Add `gameId` to `GammaEvent` type
2. In `mapGammaEventToEvent`, propagate the event's `gameId` to each child market (if the market doesn't already have its own `gameId`)
3. Store the event-level `gameId` on the `Event` domain model so it can be used in matching

### Fix 3: Debug logging for unmatched events

Add per-event debug logging in `matchEventsToFixtures` when Tier 2 fails, showing:
- Event title and parsed team names
- Which step failed (title parse, team match, date match)
- The fixture candidates that were compared against

### Trade-offs

- **Symmetric alias resolution** means both Polymarket AND API-Football names get aliased. If a name appears in TEAM_ALIASES, it'll be mapped regardless of source. This is the correct behavior — aliases should represent "these names are the same team" — but it means we need to be careful when adding aliases that they don't create false positives (e.g., two different teams that alias to the same string).
- **Propagating gameId** adds a field that won't produce matches today (different ID spaces). This is low-risk prep work for future cross-referencing.
- **Debug logging** in the hot path of matching could be noisy. Using `logger.debug` ensures it's off by default.

---

## Changes Required

### `src/domain/services/team-names.ts`

Change `teamNamesMatch` to use `resolveTeamName` on both arguments:

```typescript
export function teamNamesMatch(polymarketName: string, apiFootballName: string): boolean {
  const resolved = resolveTeamName(polymarketName);
  const normalized = resolveTeamName(apiFootballName);

  if (resolved === normalized) return true;
  return resolved.includes(normalized) || normalized.includes(resolved);
}
```

### `src/infrastructure/polymarket/types.ts`

Add `gameId` to `GammaEvent`:

```typescript
export type GammaEvent = {
  // ... existing fields ...
  gameId: number | string | null;  // Polymarket's internal game identifier
  // ...
};
```

### `src/infrastructure/polymarket/mappers.ts`

Propagate event-level `gameId` to child markets:

```typescript
export function mapGammaEventToEvent(raw: GammaEvent): Event {
  const polymarketUrl = `https://polymarket.com/sports/${raw.seriesSlug}/${raw.slug}`;
  const eventGameId = raw.gameId != null ? String(raw.gameId) : null;

  const markets = raw.markets
    .map(mapGammaMarketToMarket)
    .filter((m): m is Market => m !== null)
    .map((m) => ({
      ...m,
      polymarketUrl,
      gameId: m.gameId ?? eventGameId,  // market-level takes precedence
    }));

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    startDate: raw.startTime || raw.startDate,
    endDate: raw.endDate,
    active: raw.active,
    closed: raw.closed,
    markets,
  };
}
```

### `src/domain/services/market-matching.ts`

Add debug logging for unmatched events:

```typescript
import { logger } from "../../shared/logger.ts";

function matchByTeamNameAndDate(event: Event, fixtures: Fixture[]): Fixture | null {
  const parsed = parseEventTitle(event.title);
  if (!parsed) {
    logger.debug("Matching: event title unparseable", {
      eventId: event.id,
      title: event.title,
    });
    return null;
  }

  for (const fixture of fixtures) {
    const homeMatch = /* ... existing logic ... */;
    const awayMatch = /* ... existing logic ... */;

    if (!homeMatch || !awayMatch) continue;

    const dateMatch = sameDateUTC(event.startDate, fixture.date);
    if (dateMatch) return fixture;
  }

  logger.debug("Matching: no fixture found for event", {
    eventId: event.id,
    title: event.title,
    parsedHome: parsed.homeTeam,
    parsedAway: parsed.awayTeam,
    eventDate: event.startDate,
    fixtureCount: fixtures.length,
  });

  return null;
}
```

### `tests/unit/domain/services/team-names.test.ts`

Add test cases for the three broken aliases:

```typescript
test("matches Nottingham Forest via symmetric alias resolution", () => {
  expect(teamNamesMatch("Nottingham Forest FC", "Nottingham Forest")).toBe(true);
});

test("matches Sheffield United via symmetric alias resolution", () => {
  expect(teamNamesMatch("Sheffield United FC", "Sheffield United")).toBe(true);
});

test("matches Athletic Bilbao to Athletic Club and vice versa", () => {
  expect(teamNamesMatch("Athletic Bilbao", "Athletic Club")).toBe(true);
  expect(teamNamesMatch("Athletic Club", "Athletic Bilbao")).toBe(true);
});
```

### `tests/unit/domain/services/matching.test.ts`

Add an integration-level test for the Nottingham Forest scenario:

```typescript
test("matches Nottingham Forest event to fixture", () => {
  const event = makeEvent({
    title: "Manchester City FC vs. Nottingham Forest FC",
    startDate: "2026-03-04T19:30:00Z",
    markets: [makeMarket({ gameId: null })],
  });
  const fixture = makeFixture({
    homeTeam: { id: 50, name: "Manchester City", logo: null },
    awayTeam: { id: 65, name: "Nottingham Forest", logo: null },
    date: "2026-03-04T19:30:00Z",
  });

  const result = matchEventsToFixtures([event], [fixture]);
  expect(result.matched).toHaveLength(1);
});
```

### `tests/unit/infrastructure/polymarket/mappers.test.ts`

Add test for gameId propagation from event to market:

```typescript
test("propagates event-level gameId to markets lacking their own", () => {
  const raw: GammaEvent = {
    // ...event fields with gameId: 90091278...
    markets: [{ /* market without gameId */ }],
  };
  const event = mapGammaEventToEvent(raw);
  expect(event.markets[0]?.gameId).toBe("90091278");
});
```

---

## Test Plan

| # | Scenario | Asserts |
|---|----------|---------|
| 1 | `teamNamesMatch("Nottingham Forest FC", "Nottingham Forest")` | returns `true` |
| 2 | `teamNamesMatch("Sheffield United FC", "Sheffield United")` | returns `true` |
| 3 | `teamNamesMatch("Athletic Bilbao", "Athletic Club")` | returns `true` |
| 4 | Existing Manchester City vs Manchester United collision test | still returns `false` |
| 5 | All existing `teamNamesMatch` tests | still pass (no regressions) |
| 6 | `matchEventsToFixtures` with Nottingham Forest event + fixture | matches correctly |
| 7 | Event-level `gameId` propagated to markets in mapper | `market.gameId === "90091278"` |
| 8 | Market with its own `gameId` keeps it (not overwritten by event) | `market.gameId` unchanged |

---

## Task Breakdown

- [x] Fix `teamNamesMatch` in `src/domain/services/team-names.ts` to call `resolveTeamName` on both arguments
- [x] Add test cases for Nottingham Forest, Sheffield United, Athletic Bilbao matching in `tests/unit/domain/services/team-names.test.ts`
- [x] Add Nottingham Forest integration test in `tests/unit/domain/services/matching.test.ts`
- [x] Add `gameId` field to `GammaEvent` type in `src/infrastructure/polymarket/types.ts`
- [x] Update `mapGammaEventToEvent` in `src/infrastructure/polymarket/mappers.ts` to propagate event-level `gameId` to markets
- [x] Add mapper test for gameId propagation in `tests/unit/infrastructure/polymarket/mappers.test.ts`
- [x] Add debug logging to `matchByTeamNameAndDate` in `src/domain/services/market-matching.ts`
- [x] Run `bun test` to verify all existing tests still pass and new tests pass

## Test Cases
id	condition_id	slug	question	outcomes	outcome_prices	token_ids	active	closed	accepting_orders	liquidity	volume	game_id	sports_market_type	line	created_at	updated_at	fixture_id	polymarket_url
1396101	0x55aaedf58a379e677f1a72150605119fcbed1c4cb90d163d1bff2445053f4a18	epl-mac-not-2026-03-04-mac	Will Manchester City FC win on 2026-03-04?	"[""Yes"",""No""]"	"[""0.685"",""0.315""]"	"[""9905182191081640008785238475821743195069863814919754172072310065259430277428"",""47360322818856779953484901624413028936225139926711290257453918602423436817642""]"	1	0	1	640856.2676	1251343.118806		moneyline		1772611236	1772611372		https://polymarket.com/sports/premier-league-2025/epl-mac-not-2026-03-04
1396102	0x178ae8f7dfb97c400159a7e9ed20978875d693b0c28e802060de49c8af9efd2d	epl-mac-not-2026-03-04-draw	Will Manchester City FC vs. Nottingham Forest FC end in a draw?	"[""Yes"",""No""]"	"[""0.185"",""0.815""]"	"[""64144959226150001904649168449179864176392728644958734056667250972441200592906"",""58614554860064634467493322826734463153491506741639709750547987844611568648040""]"	1	0	1	508437.4927	11742.830102		moneyline		1772611236	1772611372		https://polymarket.com/sports/premier-league-2025/epl-mac-not-2026-03-04
1396103	0xd5f2902e93b56141a0e90a3f9bf447e7c1b3577b910006a61f58e980c421e86c	epl-mac-not-2026-03-04-not	Will Nottingham Forest FC win on 2026-03-04?	"[""Yes"",""No""]"	"[""0.125"",""0.875""]"	"[""31072249292754572496770812315930154110863409090768279651138089060084498713769"",""99376370120427442052171307099085804857004919613109551972395179506951747373851""]"	1	0	1	508370.9299	53083.851308		moneyline		1772611236	1772611372		https://polymarket.com/sports/premier-league-2025/epl-mac-not-2026-03-04
1480740	0x191ff38347935a3b108ee9d5e05c2bdfc018b331c8639fda07ecdce6495a048e	epl-not-ful-2026-03-15-not	Will Nottingham Forest FC win on 2026-03-15?	"[""Yes"",""No""]"	"[""0.44"",""0.56""]"	"[""53826182091114174886828435963756500685188864753078374559198340086078124917899"",""113040353500743923899093749200509781860162687066099703883831193969436805148644""]"	1	0	1	3187.8316	0.0		moneyline		1772611236	1772611372		https://polymarket.com/sports/premier-league-2025/epl-not-ful-2026-03-15
1480742	0xca101a7aaab7e9dcd1b53e6aaf0655d9f5f9ff54280f699aa16b15007605199e	epl-not-ful-2026-03-15-draw	Will Nottingham Forest FC vs. Fulham FC end in a draw?	"[""Yes"",""No""]"	"[""0.27"",""0.73""]"	"[""41465099298725482263011127667380436500917804417808564908106579010431828446429"",""61246809443172949894023454406287947447810835047379100936732051953925424399205""]"	1	0	1	3573.5645	0.0		moneyline		1772611236	1772611372		https://polymarket.com/sports/premier-league-2025/epl-not-ful-2026-03-15
1480744	0xe3f95e00b2c15f1d0f3bdc5324cb29869e979e77695193fa5ab0c65ef29ece48	epl-not-ful-2026-03-15-ful	Will Fulham FC win on 2026-03-15?	"[""Yes"",""No""]"	"[""0.29"",""0.71""]"	"[""36339850254157377830381845388945943780350502305284825112673686524258047733362"",""23334940123661140906812301385003987489412432031488779578365886394605366005400""]"	1	0	1	3440.1146	9.185302		moneyline		1772611236	1772611372		https://polymarket.com/sports/premier-league-2025/epl-not-ful-2026-03-15
1488887	0x22210ba50e974556bb194cd0f0176ae82dc2ac1b2db42e2ad2c20801ff9f5c8b	epl-bre-wol-2026-03-16-bre	Will Brentford FC win on 2026-03-16?	"[""Yes"",""No""]"	"[""0.58"",""0.42""]"	"[""47494701246623683904467099439211712078496707997982781452643608690648347494691"",""65518682212022781901729149980017915467817457835152287376501549020779362175695""]"	1	0	1	3083.6621	497.856303		moneyline		1772611236	1772611372		https://polymarket.com/sports/premier-league-2025/epl-bre-wol-2026-03-16
1488892	0xa5f126bcb7fc625d36b56a5e83c146bc6c7a1c58a907d61079de3bbefba5d95f	epl-bre-wol-2026-03-16-draw	Will Brentford FC vs. Wolverhampton Wanderers FC end in a draw?	"[""Yes"",""No""]"	"[""0.225"",""0.775""]"	"[""36847072724559173717932852521154454046199061185812140044701797780609311414898"",""9348804764823995428296154963989219895718178014554567894951462406144818261208""]"	1	0	1	3263.0531	0.0		moneyline		1772611236	1772611372		https://polymarket.com/sports/premier-league-2025/epl-bre-wol-2026-03-16
1488895	0x4e9503f9206b70496c06f6b447b0fd22468bd6dc45edf4f08d045629a47dc176	epl-bre-wol-2026-03-16-wol	Will Wolverhampton Wanderers FC win on 2026-03-16?	"[""Yes"",""No""]"	"[""0.17"",""0.83""]"	"[""98107912998624786361577465233693172875466676473751002010266720534494299124333"",""44793860948810476642030223136795874258351936375138856558421735405165202363047""]"	1	0	1	3286.4337	15.0		moneyline		1772611236	1772611372		https://polymarket.com/sports/premier-league-2025/epl-bre-wol-2026-03-16
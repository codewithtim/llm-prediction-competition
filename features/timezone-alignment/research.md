# Research: Timezone Alignment Across All Data Sources

**Date:** 2026-03-04
**Scope:** Full audit of how dates and times are created, stored, compared, and displayed across the Football API, Polymarket, the database, the scheduler, and the UI — to verify UTC alignment and identify any timezone-related risks.

---

## Overview

The system ingests game times from two external sources (API-Football and Polymarket), stores them in a SQLite/Turso database, compares them to determine fixture-market matching and prediction readiness, and displays them in a web UI. All backend date handling uses native JavaScript `Date` objects with no third-party date libraries. The overall approach is sound: ISO 8601 strings for fixture dates, Unix epoch timestamps for other columns, and explicit UTC extraction where needed. However, there are a few gaps worth understanding.

---

## Data Sources and Their Timezone Formats

### 1. API-Football (Sports Data)

**Response format** (`src/infrastructure/sports-data/types.ts:10-18`):
```typescript
fixture: {
  timezone: string;   // e.g. "UTC"
  date: string;       // ISO 8601: "2026-03-05T20:00:00+00:00"
  timestamp: number;  // Unix seconds
}
```

The API supports a `timezone` query parameter that controls what timezone the `date` field is returned in. **The codebase does NOT pass a `timezone` parameter** when calling the API (`src/infrastructure/sports-data/client.ts:33-35`). The API-Football default is `UTC`, so dates come back in UTC by default. This is confirmed by the response format showing `+00:00` offsets in test fixtures.

**How dates are used**: The `date` field from API-Football is stored as-is into the database as a text column (`src/infrastructure/sports-data/mappers.ts:62`). No transformation occurs.

**Risk level**: LOW. The API defaults to UTC, and the date is stored verbatim. However, this is an implicit reliance on a default — if the API's default ever changed (unlikely), dates would silently shift.

### 2. Polymarket (Gamma API)

**Response format** (`src/infrastructure/polymarket/types.ts:36-52`):
```typescript
GammaEvent: {
  startDate: string;   // ISO 8601
  endDate: string;     // ISO 8601
  eventDate: string;   // ISO 8601
  startTime: string;   // ISO 8601
}
```

**How dates are used**: The mapper prefers `startTime` over `startDate` (`src/infrastructure/polymarket/mappers.ts:43`):
```typescript
startDate: raw.startTime || raw.startDate,
```

The `startDate` is used for fixture-to-market matching via `sameDateUTC()`. Polymarket event queries use `now.toISOString()` and `endDate.toISOString()` for date range filters (`src/infrastructure/polymarket/market-discovery.ts:58-59`), which produce UTC strings (ISO `toISOString()` always returns UTC with `Z` suffix).

**Risk level**: LOW. ISO 8601 strings from Polymarket preserve timezone information. The `sameDateUTC()` function correctly normalizes both sides to UTC dates before comparison.

---

## Database Storage

### Timestamp Columns (integer, mode: "timestamp")

All `createdAt`, `updatedAt`, `placedAt`, `settledAt`, `lastAttemptAt`, and `fetchedAt` columns use Drizzle's `integer("...", { mode: "timestamp" })` (`src/infrastructure/database/schema.ts`). Drizzle's `mode: "timestamp"` stores a Unix epoch as an integer and converts to/from JavaScript `Date` objects. This is timezone-agnostic — epoch timestamps are inherently UTC.

**One notable exception**: In the raw SQL `createIfNoActiveBet` method (`src/infrastructure/database/repositories/bets.ts:72`), the `placedAt` is manually converted:
```typescript
${Math.floor(placedAt.getTime() / 1000)}
```
This converts to Unix seconds, which is correct and timezone-safe.

### Fixture Date Column (text)

The `fixtures.date` column stores ISO 8601 strings as text (`src/infrastructure/database/schema.ts:43`):
```typescript
date: text("date").notNull(),
```

This preserves whatever timezone offset the API-Football response included. Since API-Football defaults to UTC, these strings will typically be `"2026-03-05T20:00:00+00:00"` format.

**Risk level**: LOW. Text storage preserves the original string, and all comparisons use `extractUTCDate()` which normalizes to UTC.

---

## Critical Date Comparison Logic

### Fixture-to-Market Matching

**File**: `src/domain/services/market-matching.ts:51`

The matching compares Polymarket's `event.startDate` with the fixture's `date` using:
```typescript
const dateMatch = sameDateUTC(event.startDate, fixture.date);
```

**`sameDateUTC`** (`src/domain/services/event-parser.ts:31-33`) calls `extractUTCDate()` on both strings, which:
1. Parses with `new Date(isoString)` — handles any valid ISO 8601 string with any offset
2. Extracts year/month/day using `getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()` — always in UTC

**Test coverage** (`tests/unit/domain/services/event-parser.test.ts:50-77`): Tests cover UTC strings, offset strings, and cross-midnight timezone conversions. The tests confirm correct behavior.

**Risk level**: VERY LOW. This is the most timezone-critical comparison in the system, and it's correctly implemented and well-tested.

### Fixture Readiness for Prediction

**File**: `src/infrastructure/database/repositories/fixtures.ts:60-70`

```typescript
async findReadyForPrediction(leadTimeMs: number) {
  const now = toISONoMs(new Date());
  const cutoff = toISONoMs(new Date(Date.now() + leadTimeMs));
  return db.select().from(fixtures)
    .where(and(
      eq(fixtures.status, "scheduled"),
      lte(fixtures.date, cutoff),
      gt(fixtures.date, now),
    )).all();
}
```

Where `toISONoMs` (`line 5-7`):
```typescript
function toISONoMs(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
```

This compares ISO 8601 strings lexicographically. **This relies on both the fixture date and the generated `now`/`cutoff` strings being in the same format for lexicographic ordering to work correctly.**

- `new Date().toISOString()` always produces UTC: `"2026-03-04T12:00:00Z"` (after stripping ms)
- Fixture dates from API-Football use `+00:00` offset format: `"2026-03-05T20:00:00+00:00"`

**POTENTIAL ISSUE**: `"2026-03-05T20:00:00+00:00"` vs `"2026-03-05T20:00:00Z"` — these represent the same instant but are NOT lexicographically equal. The `+00:00` suffix sorts AFTER `Z`. Let's trace what actually gets stored:

Looking at API-Football's typical response: the `date` field comes with `+00:00` (not `Z`). This is stored verbatim. The `toISONoMs` function produces strings ending in `Z`. So the comparison becomes:
- `"2026-03-05T20:00:00+00:00"` (fixture) `<=` `"2026-03-05T20:30:00Z"` (cutoff)

Lexicographically: `+` (ASCII 43) comes before `Z` (ASCII 90), so `+00:00` < `Z`. This means `"2026-03-05T20:00:00+00:00"` < `"2026-03-05T20:30:00Z"` — which happens to give the **correct** result because `+` sorts before `Z`. The fixture date will always sort as "less than" a UTC `Z`-formatted string at any time, which means fixtures will always pass the `lte(fixtures.date, cutoff)` check and the `gt(fixtures.date, now)` check.

Wait — let's be more precise. If the fixture is at `"2026-03-05T20:00:00+00:00"` and `now` is `"2026-03-05T21:00:00Z"`:
- `gt(fixtures.date, now)` → `"2026-03-05T20:00:00+00:00" > "2026-03-05T21:00:00Z"`
- Character comparison: both match up to `T20:` vs `T21:` — `0` < `1`, so the fixture date is LESS, not greater. Result: false (correctly excludes past fixtures).

But consider: fixture at `"2026-03-05T20:00:00+00:00"` and `now` is `"2026-03-05T19:30:00Z"`:
- `gt(fixtures.date, now)` → `"2026-03-05T20:00:00+00:00" > "2026-03-05T19:30:00Z"`
- `T20:` vs `T19:` — `2` > `1`, so YES, greater. Correct.

Now edge case: fixture at `"2026-03-05T20:00:00+00:00"` and `now` is `"2026-03-05T20:00:00Z"`:
- `gt(fixtures.date, now)` → `"2026-03-05T20:00:00+00:00" > "2026-03-05T20:00:00Z"`
- Strings match up to `T20:00:00`, then `+` (43) vs `Z` (90) — `+` < `Z`, so NO, not greater. This would **incorrectly exclude** a fixture whose kickoff is right now. However, this is a trivially narrow edge case (exact second match) and the `gt` (greater-than, not greater-or-equal) would exclude the exact-second match anyway.

**Risk level**: LOW-MEDIUM. The lexicographic comparison works correctly in practice because `+` sorts before `Z`, which means fixture dates with `+00:00` are treated as slightly "earlier" than equivalent `Z` timestamps. This introduces a negligible sub-second bias that has no practical impact. However, if fixtures were ever returned with a **non-zero offset** (e.g., `+01:00`), the lexicographic comparison would be **incorrect** — a fixture at `"2026-03-05T21:00:00+01:00"` (which is 20:00 UTC) would sort between `T21:` and `T22:`, making it appear to be at 21:00 rather than 20:00. **This would only happen if someone passed a `timezone` parameter to the Football API, which the code does not do, so the API defaults to UTC.** Still, this is an implicit fragility.

### Fixture Status Update Check

**File**: `src/infrastructure/database/repositories/fixtures.ts:72-84`

```typescript
async findNeedingStatusUpdate() {
  const now = toISONoMs(new Date());
  return db.select().from(fixtures)
    .where(or(
      and(eq(fixtures.status, "scheduled"), lte(fixtures.date, now)),
      eq(fixtures.status, "in_progress"),
    )).all();
}
```

Same lexicographic comparison pattern. Same analysis applies — works correctly as long as fixture dates use UTC offsets.

---

## Scheduler Timing

**File**: `src/orchestrator/scheduler.ts`

The scheduler uses `setInterval` with millisecond durations. No timezone-aware scheduling (no cron, no "run at 3 PM London time"). All timing is purely relative:
- `Date.now()` for duration measurement (lines 59, 63, 88, 92, etc.)
- Intervals configured in milliseconds (`src/orchestrator/config.ts:51-78`)

**Risk level**: NONE. Interval-based scheduling is completely timezone-independent.

---

## Discovery Pipeline Date Queries

### Football API Date Range

**File**: `src/orchestrator/discovery-pipeline.ts:107-111`

```typescript
const today = new Date();
const lookAhead = new Date(today);
lookAhead.setDate(lookAhead.getDate() + config.fixtureLookAheadDays);
const from = formatDateISO(today);  // "2026-03-04"
const to = formatDateISO(lookAhead); // "2026-03-18"
```

Where `formatDateISO` (line 49-51):
```typescript
function formatDateISO(date: Date): string {
  return date.toISOString().split("T")[0] as string;
}
```

This extracts the UTC date portion. The `from`/`to` params are date-only strings (`YYYY-MM-DD`), which API-Football interprets as UTC dates.

**Risk level**: LOW. Using `toISOString().split("T")[0]` gives the UTC date, matching what the API expects. One edge case: if the server is running at, say, 23:30 UTC, `today` is still the correct UTC date. If the server were in a non-UTC timezone and used local date methods, this could be wrong — but `toISOString()` always uses UTC, so it's fine.

### Polymarket Date Range

**File**: `src/infrastructure/polymarket/market-discovery.ts:42-59`

```typescript
const now = new Date();
const endDate = new Date(now);
endDate.setDate(endDate.getDate() + config.lookAheadDays);
// ...
end_date_min: now.toISOString(),     // UTC
end_date_max: endDate.toISOString(), // UTC
```

`toISOString()` produces UTC. Polymarket expects ISO 8601 strings.

**Risk level**: NONE.

---

## Server Deployment and TZ Environment

**Dockerfile** (`Dockerfile`): Base image is `oven/bun:1.3`. No `TZ` environment variable is set. The default timezone for Linux Docker containers is UTC.

**Deploy workflow** (`.github/workflows/deploy.yml`): The `.env` file written to the server contains `NODE_ENV=production` and API keys — **no `TZ` variable**.

**Infrastructure** (`infra/index.ts`): DigitalOcean droplet in `lon1` region. Ubuntu 24.04. No timezone configuration in user data.

**Risk level**: LOW. Docker containers default to UTC. The DigitalOcean droplet runs Ubuntu which defaults to UTC. Since `new Date()` and `Date.now()` return UTC-based values, and `toISOString()` always outputs UTC, the server timezone is irrelevant for all backend operations. The only place server timezone could matter is `toLocaleDateString()` or `toLocaleTimeString()` calls — but these only exist in the UI code (browser-side).

---

## UI Date Display

**File**: `ui/src/lib/format.ts:10-27`

```typescript
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
```

These use `toLocaleDateString`, which formats dates in the **browser's local timezone**. A user in the US viewing a 20:00 UTC fixture would see it displayed as 3:00 PM ET or 12:00 PM PT. This is standard and expected behavior for a user-facing UI.

**Risk level**: NONE (for correctness). Users see times in their own timezone, which is the expected UX for viewing kickoff times. If you wanted explicit UTC display, you'd pass `{ timeZone: "UTC" }` in the options.

---

## Interactions with the Rest of the System

### Team Statistics Date Parameter

**File**: `src/infrastructure/sports-data/client.ts:49-55`

```typescript
async getTeamStatistics(teamId: number, leagueId: number, season: number, date?: string) {
  return request<ApiTeamStatisticsResponse>("/teams/statistics", {
    team: teamId, league: leagueId, season,
    ...(date ? { date: date.split("T")[0] } : {}),
  });
}
```

When `fixture.date` (an ISO string like `"2026-03-05T20:00:00+00:00"`) is passed, `split("T")[0]` extracts `"2026-03-05"`. This is fine for UTC-offset dates. If the date had a non-UTC offset (e.g., `+05:00`), the date portion before `T` might be a different calendar date than UTC — but again, this doesn't happen because the API returns UTC.

---

## Known Issues & Technical Debt

1. **No explicit `timezone=UTC` parameter to API-Football**: The code relies on the API's default being UTC. Adding `timezone: "UTC"` to every fixtures request would make this explicit and defensive. (`src/infrastructure/sports-data/client.ts`)

2. **Lexicographic ISO string comparison fragility**: `findReadyForPrediction` and `findNeedingStatusUpdate` compare fixture dates (with `+00:00` suffix) against generated dates (with `Z` suffix) lexicographically. This works by coincidence (`+` < `Z` in ASCII) but would break for non-zero timezone offsets. A more robust approach would normalize fixture dates to `Z` format on storage, or compare epoch timestamps.

3. **No documentation of UTC-everywhere assumption**: There's no explicit comment or documentation stating that all dates must be UTC. A future contributor might not realize this constraint.

---

## Summary of Key Facts

- **All backend dates are effectively UTC.** `new Date()`, `Date.now()`, and `toISOString()` are timezone-agnostic (they work in UTC regardless of server timezone).
- **API-Football returns UTC by default** because no `timezone` parameter is passed. The `fixture.date` ISO string is stored verbatim as text.
- **Polymarket dates come as ISO 8601** strings. `toISOString()` is used for query filters, producing UTC.
- **Fixture-to-market matching uses `sameDateUTC()`**, which correctly extracts UTC dates from any ISO 8601 string. This is the most critical timezone-sensitive operation and it's well-implemented.
- **Fixture readiness queries use lexicographic ISO string comparison**, which works correctly given that all dates use UTC offsets (`+00:00` or `Z`). This is a fragility, not a bug.
- **The Docker container and DigitalOcean droplet both default to UTC**, so `new Date()` behaves consistently in production.
- **The UI displays dates in the browser's local timezone** — this is expected and correct behavior.
- **No `TZ` environment variable is set anywhere** in the deployment chain.
- **No third-party date library is used** — all handling is native JS `Date`.
- **The only actionable hardening** would be: (a) explicitly pass `timezone: "UTC"` to API-Football requests, and (b) normalize fixture dates to `Z` format on storage to eliminate the lexicographic comparison fragility. Neither is urgent — the system works correctly as-is.

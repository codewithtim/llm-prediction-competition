# Review: Add Error Handling to External API Clients & Fix Signals Schema

**Reviewed:** 2026-03-04
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** No plan file — standalone commit
**Verdict:** APPROVED WITH CHANGES

## Summary

This commit adds consistent error wrapping across all external API clients (OpenRouter, Polymarket CLOB, Gamma REST, API-Football) so that thrown errors include the method name, relevant IDs, and HTTP status codes. It also tightens the JSON schema sent to the LLM for weight generation, replacing a permissive `additionalProperties: { type: "number" }` with explicit named properties and `additionalProperties: false`. Both changes are solid and operationally valuable. One minor test gap to address.

## Findings

### Architecture & Design — Pass

All changes are scoped to the infrastructure layer, which is the correct place for API client error wrapping. No domain or orchestrator layer changes. The `gammaFetch` helper (`gamma-client.ts:5-16`) is a clean centralisation — previously each method had its own `if (!res.ok)` check with slightly inconsistent error formats. Now there's a single error path.

The betting-client and pricing-client follow the same wrapping pattern: catch → re-throw with context. This is straightforward and consistent across both files.

### TypeScript & Type Safety — Concern

The OpenRouter error handling at `client.ts:50-51` uses a narrowing check followed by an `as` cast:

```typescript
if (err instanceof Error && "statusCode" in err) {
  const sdkErr = err as { statusCode: number; body?: string };
```

The `in` check confirms `statusCode` exists, and the `as` cast is needed because the OpenRouter SDK doesn't export a typed error class. This is acceptable — the cast only asserts the shape of properties we've already verified exist, and `body` is optional. Not blocking.

### Data Validation & Zod — Pass

The `WEIGHT_JSON_SCHEMA` fix (`types.ts:56-58`) is a meaningful improvement. Before, the schema allowed any string key with a number value, meaning the LLM could invent signal names or omit required ones without the JSON schema enforcement catching it. Now:
- Each signal is explicitly listed as a property
- All signals are required
- `additionalProperties: false` prevents extra keys

The schema is dynamically derived from `FEATURE_NAMES`, so it stays in sync with the registry — good design.

### Database & Drizzle ORM — Pass

No database changes in this commit.

### Security — Pass

- API keys are never included in error messages. The OpenRouter error at `client.ts:74` includes `model` name but not the API key.
- The API-Football client continues to send the API key only via the `x-apisports-key` header (`client.ts:26`), never in error output.
- No wallet credentials or CLOB API secrets appear in any error messages — only `orderId` and `tokenId` identifiers.

### Testing — Concern

Error message format changes are correctly updated in tests:
- `gamma-client.test.ts:55,107,173` — updated to match `(HTTP 500)` format
- `client.test.ts:185,193` — updated to match `(HTTP 500)` and `(HTTP 403)` formats

However, the gamma-client test mock (`gamma-client.test.ts:12-21`) only provides `json()` on the mock Response, not `text()`. The new `gammaFetch` helper calls `res.text()` on error responses (`gamma-client.ts:10`). The `try/catch` around it means the test still passes (the `text()` call fails, the catch swallows it, `detail` stays empty), but the **error body inclusion feature is untested**. There's no test that verifies an error response body appears in the error message.

The API-Football error test has a similar gap: the mock returns `{}` as the error body, so `body?.errors` is `undefined` and the `detail` stays empty. There's no test that verifies the `errors` object from API-Football is included in the error message.

### Error Handling & Resilience — Pass

This is the point of the commit and it's done well:

- **OpenRouter** (`client.ts:49-77`): Deep parsing of the nested error structure is correct. OpenRouter wraps upstream provider errors in `error.metadata.raw` as a JSON string, and the code handles both parseable and unparseable raw values. The fallback chain is: upstream provider message → `metadata.raw` string → `error.message` → `sdkErr.body` string → original `err.message`.
- **Gamma** (`gamma-client.ts:5-16`): `gammaFetch` reads `res.text()` for error detail with a try/catch — correct since error responses may not have a body.
- **API-Football** (`client.ts:28-34`): Reads `res.json()` and extracts `errors` object. The try/catch handles cases where the error response isn't valid JSON.
- **Polymarket CLOB** (`betting-client.ts:67-115`, `pricing-client.ts:10-63`): Consistent pattern of catch → re-throw with method name and relevant IDs. Original error message is preserved.

All wrappers use `err instanceof Error ? err.message : String(err)` for safe error message extraction. No errors are swallowed — they're all re-thrown with added context.

### Code Quality & Conventions — Pass

- Consistent wrapping pattern across all clients: try/catch → re-throw with `MethodName failed (identifier): message`
- No dead code or unused imports
- The `gammaFetch` helper eliminates 4 separate `if (!res.ok)` checks — good DRY improvement
- Error messages are informative and follow a consistent format: `${Service} ${method} failed (${context}): ${detail}`

### Operational Concerns — Pass

- Error messages now include HTTP status codes in a consistent `(HTTP NNN)` format, making log searches easier
- The OpenRouter error handler extracts the upstream provider name (`meta.provider_name`) which is valuable for debugging model routing issues
- The `placeOrder` method in `betting-client.ts:30-64` was not modified — it already had its own error handling for the CLOB response shape. Note: `placeOrder` internally calls `clob.getTickSize` and `clob.getNegRisk` directly (lines 36-37), bypassing the new wrappers. Errors from these internal calls would still have raw CLOB SDK error messages. This is pre-existing and not in scope.

## What's Done Well

- **`gammaFetch` helper** (`gamma-client.ts:5-16`) — Clean extraction that centralises error handling and includes the full endpoint path (with query params) in error messages, making it easy to debug which exact API call failed.
- **OpenRouter nested error parsing** (`client.ts:49-77`) — Handles the real-world complexity of OpenRouter's error structure where upstream provider errors are JSON-encoded inside a metadata field. The fallback chain ensures something useful is always surfaced.
- **Schema tightening** (`types.ts:56-58`) — Moving from `additionalProperties: { type: "number" }` to explicit properties with `required` and `additionalProperties: false` prevents the LLM from generating invalid signal names or omitting required ones.
- **Consistent error format** — All clients now follow `Service method failed (context): detail`, making log grep/analysis uniform.

## Must-Do Changes

None.

## Should-Do Changes

Recommended but not blocking:

- [ ] **Add `text()` to the gamma-client test mock** (`tests/unit/infrastructure/polymarket/gamma-client.test.ts:12-21`) — The mock Response only has `json()`, but `gammaFetch` now calls `res.text()` on error. Add `text: () => Promise.resolve(JSON.stringify(response.body))` to the mock and add a test case that verifies error response bodies appear in the thrown error message. This confirms the error body extraction actually works.
- [ ] **Add an API-Football error body test** (`tests/unit/infrastructure/sports-data/client.test.ts`) — Add a test where the error response body includes `{ errors: { ... } }` and verify the detail appears in the error message. Currently both error tests use `{}` as the body, so the error detail extraction path is untested.

## Questions for the Author

None — the changes are straightforward and well-executed. The schema fix and error wrapping are both clear operational improvements.

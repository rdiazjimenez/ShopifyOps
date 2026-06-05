# Plan
Office + Azure + Worker Integration

## Summary
Add an Excel-native workflow for the bulk update feature:

`Excel Office Script -> Azure/Power Automate -> Cloudflare Worker -> Shopify`

Office owns workbook interaction. Azure owns identity, secrets, and orchestration. The Worker remains the source of truth for row rules, validation, Shopify mutations, and Result Reports.

## Why This Shape
- Keeps `API_KEY` out of Excel scripts and browser-visible code.
- Avoids direct Office Script CORS/auth problems.
- Preserves current Worker architecture and PRD decision: all Shopify product logic lives in the Worker.
- Lets merchants run the process from the workbook they already use.
- Keeps existing `/bulk-update` workbook-upload endpoint for Pages, Shopify app, and headless callers.

## Target User Flow
1. Merchant opens Matrixify-format workbook in Excel.
2. Merchant runs an Office Script or Power Automate button.
3. Script reads the selected sheet/table into structured JSON rows.
4. Azure/Power Automate calls the Worker with server-side `X-Api-Key`.
5. Worker returns the standard Result Report.
6. Office Script writes `Status` and `Reason` back to the workbook and creates/updates a `Results` sheet.

## Architecture

### Excel Office Script
Responsibilities:
- Read active sheet or named sheet.
- Detect headers using same Matrixify column names.
- Convert rows to structured JSON.
- Optionally require a `dryRun` parameter.
- Write returned row outcomes into `Status` and `Reason` columns.
- Create or replace a `Results` summary sheet.

Non-responsibilities:
- No Shopify API calls.
- No Worker `API_KEY`.
- No business rule duplication beyond basic sheet/range extraction.

### Azure / Power Automate Layer
Preferred first version: Power Automate flow.

Responsibilities:
- Trigger from Excel/manual button.
- Run Office Script to extract rows.
- Call Worker with `X-Api-Key` stored in flow/Azure secret config.
- Return Worker report to Excel.
- Run Office Script to annotate workbook.

Later option: Azure Function.

Use Azure Function if we need:
- Better audit logs.
- Entra ID auth from Excel.
- Centralized retry/backoff policy.
- Cleaner CI/CD.
- Multiple workbooks/users.
- More precise error handling than Power Automate.

### Cloudflare Worker
Add a JSON row endpoint:

`POST /bulk-update/rows?dryRun=<true|false>`

Headers:
- `X-Api-Key: <secret>`
- `Content-Type: application/json`

Body:

```json
{
  "source": "excel-office-script",
  "sheet": "Products",
  "rows": []
}
```

Response:
- Same Result Report shape as `/bulk-update`.

Keep existing endpoint:

`POST /bulk-update?sheet=<sheetName>&dryRun=<true|false>`

No behavior changes for workbook upload callers.

## Worker Implementation Plan
1. Extract shared execution path:
   - Current `/bulk-update` parses workbook to `ParsedRow[]`.
   - New `/bulk-update/rows` accepts `ParsedRow[]`-compatible JSON.
   - Both call `runBatch(rows, client, dryRun)`.

2. Add input validation for `/bulk-update/rows`:
   - Require JSON body.
   - Require `rows` array.
   - Validate row numbers and allowed field names.
   - Normalize missing/blank `command` to existing parser behavior if needed.
   - Return 400 with structured error on invalid payload.

3. Preserve auth:
   - Same `X-Api-Key` check.
   - No CORS required for Power Automate/Azure server-side calls.
   - Do not expose Worker directly to Office Script unless explicitly accepted later.

4. Add tests:
   - Missing API key returns 401.
   - Invalid JSON returns 400.
   - Missing rows returns 400.
   - Valid rows call `runBatch`.
   - `dryRun=true` passed through.
   - Result Report invariants preserved.

## Office Script Plan
Create two scripts first:

### Extract Rows
Inputs:
- `sheetName?: string`
- `dryRun?: boolean`

Output:

```ts
interface BulkUpdatePayload {
  source: "excel-office-script";
  sheet: string;
  rows: BulkUpdateRow[];
}
```

Behavior:
- Uses active worksheet if `sheetName` absent.
- Reads used range.
- Finds header row at row 1 for v1.
- Builds rows using Matrixify headers.
- Keeps row numbers aligned with Excel data rows.

### Apply Results
Input:

```ts
interface ResultReport {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  rows: Array<{
    row: number;
    lookupKey: string;
    status: "success" | "failed" | "skipped";
    reason?: string;
  }>;
}
```

Behavior:
- Adds or reuses `Status` and `Reason` columns.
- Writes per-row outcomes.
- Creates/replaces `Results` sheet with summary counts.

## Power Automate Plan
Flow v1:
1. Manual trigger from workbook or Excel button.
2. Run script: Extract Rows.
3. HTTP POST to Worker `/bulk-update/rows?dryRun=true`.
4. Run script: Apply Results.
5. Merchant reviews results.
6. Second flow or parameterized rerun with `dryRun=false`.

Secrets:
- Store Worker `API_KEY` in Power Automate connection/secure input or Azure Key Vault-backed config if using Azure Function.
- Never store `API_KEY` in workbook or Office Script.

## Acceptance Criteria
- Office Script can extract Matrixify-format rows from Excel.
- Azure/Power Automate can call Worker without exposing `API_KEY`.
- Worker `/bulk-update/rows` returns same Result Report shape as `/bulk-update`.
- Dry run performs no Shopify mutations.
- Workbook gets `Status`, `Reason`, and `Results` output.
- Existing workbook-upload endpoint keeps passing current tests.
- Existing Pages and Shopify app plans remain compatible.

## Risks
- Power Automate has request/time limits; hundreds of rows should be okay, very large catalogs may need chunking.
- Office Script row extraction can drift from Worker Excel parser if too much parsing logic is duplicated.
- Direct Office Script `fetch` should stay out of v1 because it exposes secrets and may hit CORS/auth limits.
- Azure Function adds setup overhead; use only when flow limits become painful.

## Open Questions
- Should v1 trigger be a Power Automate button or manual script run plus flow?
- Should the row endpoint accept raw Matrixify header/value objects or strict `ParsedRow` objects?
- Should dry run and commit be separate flows or one flow with a parameter?
- Should annotated results overwrite existing `Status`/`Reason` columns or create timestamped columns?

## Recommendation
Build in this order:
1. Worker `/bulk-update/rows`.
2. Tests for JSON row endpoint.
3. Office Script extract/apply prototypes.
4. Power Automate flow using stored Worker secret.
5. Optional Azure Function if Power Automate becomes limiting.

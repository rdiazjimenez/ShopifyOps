# PRD: Bulk Update — Products, Variants, Prices & Costs

## Problem Statement

Updating prices, compare-at prices, and costs across hundreds of Shopify variants is slow and error-prone when done manually through the Shopify admin. Merchants need to prepare changes in Excel (which they already do for planning and approval), then apply those changes to Shopify in bulk without re-entering data or relying on expensive third-party apps like Matrixify for every run.

## Solution

A Cloudflare Worker (TypeScript) that accepts an Excel Workbook upload and a sheet name, parses each row using Matrixify-compatible column format, and applies the changes to Shopify via the Admin GraphQL API. The worker returns a Result Report detailing per-row outcomes (success, failed, skipped). An optional dry-run mode lets users validate changes before committing them.

Triggered via a dedicated Frontend (Cloudflare Pages + Cloudflare Access) or directly via HTTP for headless integrations. The frontend lets the merchant upload a workbook, select a sheet, toggle dry-run, view results, and download an Annotated Workbook.

## User Stories

1. As a merchant, I want to upload an Excel workbook and have variant prices updated in bulk, so that I don't have to update each variant manually in Shopify admin.
2. As a merchant, I want to upload an Excel workbook and have compare-at prices updated in bulk, so that I can run sales across many products at once.
3. As a merchant, I want to upload an Excel workbook and have cost-per-item updated in bulk, so that my margin reporting stays accurate after supplier price changes.
4. As a merchant, I want to use my existing Matrixify-format workbooks without reformatting, so that I don't have to maintain two separate spreadsheet schemas.
5. As a merchant, I want rows identified by Variant ID when available and SKU as fallback, so that I can work with both ID-based and SKU-based exports.
6. As a merchant, I want failed rows reported rather than stopping the entire batch, so that a single bad row doesn't block all my other updates.
7. As a merchant, I want a dry-run mode that shows me what would change without making any updates, so that I can validate my workbook before committing.
8. As a merchant, I want a Result Report showing total rows, successes, failures, and skips with per-row reasons, so that I can quickly identify and fix problems.
9. As a merchant, I want empty cells in my workbook to be ignored, so that I can include only the fields I want to change without accidentally blanking other fields.
10. As a merchant, I want rows with `Command = UPDATE` to fail if the variant is not found, so that I know when my lookup keys are stale.
11. As a merchant, I want rows with `Command = MERGE` to update existing variants and fail if not found (create is out of scope), so that I have a mode that still surfaces missing variants.
12. As a merchant, I want rows with unsupported Command values counted as skipped, so that I can use my full Matrixify workbook without stripping unsupported rows first.
13. As a merchant, I want to open a browser UI, upload my workbook, and see results without writing code or using curl, so that I can operate the tool independently.
14. As a merchant, I want to download an Annotated Workbook after the operation with Status and Reason per row plus a Results summary sheet, so that I have a record and can fix failures in the same file.
15. As a merchant, I want the worker to handle hundreds of rows within a reasonable time, so that large catalogue updates don't time out.
16. As a merchant, I want price, compare-at price, and cost updates grouped by product in a single mutation per product, so that updates are efficient and don't hit Shopify rate limits.
17. As a developer, I want Shopify credentials and the API key stored as Cloudflare Worker secrets, so that they are never exposed in source code or logs.
18. As a developer, I want the Excel parsing logic isolated from the Shopify mutation logic, so that each can be tested independently.
19. As a developer, I want the worker to return structured JSON for both success and error cases, so that any caller can parse and act on the result.
20. As a developer, I want the dry-run flag passed as a query parameter (`?dryRun=true`), so that it can be toggled without changing the request body.
21. As a developer, I want the worker to reject requests without a valid `X-Api-Key` header, so that the endpoint is not open to the public internet.
22. As a developer, I want the API key never sent to the browser, so that it cannot be extracted from DevTools or network traffic.

## Implementation Decisions

### Runtime
Cloudflare Worker, TypeScript. Deployed automatically via Cloudflare Workers Builds (GitHub integration — `rdiazjimenez/ShopifyOps`, branch `main`). Manual deploy via Wrangler available as fallback. Paid plan required for CPU time headroom with large batches.

### Shopify API Version
`2026-04`. Pinned in the Shopify Client Module and `wrangler.toml`. Do not use `unstable` or `latest`.

### Required Shopify API Scopes
`write_products`, `read_products`, `write_inventory`, `read_inventory`.

Note: `write_inventory` is required because cost is updated via the `inventoryItem` input on `productVariantsBulkUpdate`, which writes to the InventoryItem record.

### HTTP Interface
- `POST /bulk-update?sheet=<sheetName>&dryRun=<true|false>`
- Header: `X-Api-Key: <value>` — required; matches CF secret `API_KEY`
- Body: `multipart/form-data`, field name `file`
- Response: JSON Result Report

### Auth
Worker checks `X-Api-Key` header against CF secret `API_KEY`. Returns HTTP 401 on mismatch or absence. The Frontend proxy injects this header server-side; browser never sees the key.

### Excel Parsing Module
Accepts raw Excel file bytes and a sheet name. Returns an array of parsed rows (typed records). Column header matching is case-insensitive and whitespace-trimmed. Duplicate headers: last column wins. No Shopify knowledge.

### Shopify Client Module
Wraps Shopify Admin GraphQL API (version `2026-04`). Exposes:
- `updateVariants(productId, variants[{ id, price?, compareAtPrice?, cost? }])` — single `productVariantsBulkUpdate` mutation. Cost is passed via `inventoryItem: { cost: <value> }` nested in the variant input. Omitted fields are not sent.
- `resolveSkuToIds(sku)` → `{ variantId, productId }` — uses `first: 2`; throws typed error on 0 results (`"SKU not found"`) or 2+ results (`"SKU matches multiple variants"`).

No Excel knowledge. No separate `inventoryItemUpdate` mutation.

### Cost Mutation Approach
Cost is updated via `inventoryItem { cost }` nested inside `productVariantsBulkUpdate` — not via a separate `inventoryItemUpdate` call. This keeps price and cost in one mutation per product group, reducing API calls. Confirmed against Shopify `ProductVariantsBulkInput` schema which exposes `inventoryItem.cost`.

### Partial Update Behavior
When a product group has multiple variants and Shopify returns `userErrors`, all variants in that group are marked failed. Shopify's `productVariantsBulkUpdate` is atomic per call — if the mutation itself fails or returns userErrors, no partial success is guaranteed. Individual variant resolution errors (lookup failure before mutation) do not affect other variants or other product groups.

### GID Normalization
`Variant ID` from Matrixify may be numeric (`123456`) or a full GID (`gid://shopify/ProductVariant/123456`). Normalize to full GID before all API calls.

### Row Processor Module
Orchestrates a single row: resolves Lookup Key → dispatches fields to Shopify Client. Returns typed `ProcessedRow` (internal). No-op rows (valid lookup key + command, but no price/compareAtPrice/cost) → `skipped`, reason `"no fields to update"`.

### Command Semantics
| Command | Behaviour |
|---|---|
| `UPDATE` | Update if found; fail if not found |
| `MERGE` | Update if found; fail if not found (create is out of scope) |
| `NEW`, `DELETE`, `REPLACE`, `IGNORE`, other | Skip row |

### Batch Orchestrator
Groups rows by product → one `updateVariants` call per product. Collects outcomes into Result Report.

### Result Report Shape
```typescript
{
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
`total === succeeded + failed + skipped` always. `rows.length === total` always. `reason` is present on failed and skipped rows; absent on success rows.

### Lookup Key Resolution
1. `Variant ID` present → normalize to GID, use directly (no API call).
2. `Variant ID` absent, `Variant SKU` present → call `resolveSkuToIds(sku)`.
3. Neither present → fail row with reason `"no lookup key"`.

### Matrixify Column Mapping
| Excel Column | Shopify Field |
|---|---|
| `Variant ID` | Variant GID (normalize from numeric if needed) |
| `Variant SKU` | SKU (for lookup) |
| `Handle` | Product handle (informational only) |
| `Variant Price` | `price` on Variant |
| `Variant Compare At Price` | `compareAtPrice` on Variant |
| `Variant Cost` | `unitCost` via `inventoryItem.cost` in bulk mutation |
| `Command` | Operation mode |

### Frontend (Cloudflare Pages)
Plain HTML + vanilla JS hosted on Cloudflare Pages (`shopifyops-bulk-update-ui`). Protected by Cloudflare Access (Google SSO, single merchant). A Pages Function at `/api/bulk-update` proxies requests to the worker, injecting `X-Api-Key` from the `API_KEY` Pages secret. Worker URL configured via `WORKER_URL` Pages environment variable.

Frontend capabilities: file picker, sheet dropdown (populated client-side from uploaded file), dry-run toggle, submit, loading state, Result Report display (summary card + per-row table), Annotated Workbook download.

Annotated Workbook: generated client-side after response — original sheet with `Status` and `Reason` columns appended, plus a new `Results` sheet with summary counts.

## Acceptance Criteria

- **Auth:** Request without `X-Api-Key` returns 401. Wrong key returns 401. Correct key proceeds.
- **Missing sheet:** Sheet name not found in workbook returns 400 with descriptive error.
- **Dry run:** `?dryRun=true` returns Result Report with zero mutations sent to Shopify.
- **Skipped commands:** Rows with `Command = NEW/DELETE/REPLACE/IGNORE` appear in `rows[]` with `status: "skipped"`.
- **Duplicate SKU:** SKU matching 2+ variants fails that row with reason `"SKU matches multiple variants"`.
- **Missing lookup key:** Row with no Variant ID and no SKU fails with reason `"no lookup key"`.
- **Grouped mutation:** Variants belonging to the same product are sent in one `productVariantsBulkUpdate` call, not one call per variant.
- **Partial/userErrors:** Shopify `userErrors` on a product group marks all variants in that group as failed; other product groups are unaffected.
- **Result Report invariants:** `total === succeeded + failed + skipped` and `rows.length === total` in all cases.
- **No-op row:** Row with valid command and lookup key but no price/compareAtPrice/cost appears as `skipped`, reason `"no fields to update"`.

## Testing Decisions

Good tests verify external behavior only — given an Excel file (or parsed rows) and a stubbed Shopify API, the correct mutations are called and the correct Result Report is returned. Tests should not assert on internal module calls or implementation sequence.

### Modules to test

**Excel Parsing Module** — unit tested with fixture `.xlsx` files. Assert: correct row extraction, empty-cell skipping, unsupported Command skipping, missing sheet error, case-insensitive + trimmed header matching, duplicate header handling.

**Shopify Client Module** — unit tested with stubbed HTTP layer. Assert: single mutation carries price + compareAtPrice + cost; omitted fields absent from variables; `userErrors` mapped correctly; SKU not found and SKU ambiguous both throw typed errors; numeric IDs normalized to GIDs.

**Row Processor Module** — unit tested with stubbed Shopify Client. Assert: Variant ID takes precedence over SKU; no-op row returns `skipped`; UPDATE/MERGE both fail when variant not found; correct shape returned.

**Batch Orchestrator** — integration tested with stubbed Shopify Client and real Excel fixture. Assert: grouping by product; dry-run sends zero mutations; `rows.length === total`; `status` correct per outcome; `reason` present on failed/skipped, absent on success.

Prior art: `excel-parser.test.ts`, `shopify-client.test.ts`, `row-processor.test.ts`, `batch-orchestrator.test.ts` establish the pattern.

## Out of Scope

- CREATE operations (new products or variants)
- DELETE operations
- REPLACE operations
- Inventory quantity updates
- Image updates
- Metafield updates
- Multi-store support
- Money format validation (delegated to Shopify; invalid formats return `userErrors`)
- Chunking / streaming for very large batches (revisit if hit in practice)
- Shopify Admin embedded app frontend flavor (separate PRD)

## Further Notes

- The Matrixify demo workbook (`Matrixify-Import-Demo-Products.xlsx`) in the repo root serves as the reference for column format and is used as a test fixture.
- Cloudflare Workers free plan has a 10ms CPU time limit — paid plan required for batch sizes in the hundreds.
- Cost is updated via `inventoryItem { cost }` nested inside `productVariantsBulkUpdate` — no separate `inventoryItemUpdate` call. This was confirmed against the Shopify `ProductVariantsBulkInput` schema.
- Idempotency: the Result Report lets merchants safely re-run the same workbook after fixing errors — already-correct values are unchanged by the update.
- The `xlsx` CDN dependency on the frontend should be pinned to a specific version with a subresource integrity hash.

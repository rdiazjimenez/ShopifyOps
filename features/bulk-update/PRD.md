# PRD: Bulk Update — Products, Variants, Prices & Costs

## Problem Statement

Updating prices, compare-at prices, and costs across hundreds of Shopify variants is slow and error-prone when done manually through the Shopify admin. Merchants need to prepare changes in Excel (which they already do for planning and approval), then apply those changes to Shopify in bulk without re-entering data or relying on expensive third-party apps like Matrixify for every run.

## Solution

A Cloudflare Worker (TypeScript) that accepts an Excel Workbook upload and a sheet name, parses each row using Matrixify-compatible column format, and applies the changes to Shopify via the Admin GraphQL API. The worker returns a Result Report detailing successes and failures. An optional dry-run mode lets users validate changes before committing them.

Triggered via Activepieces: the user uploads the workbook, selects the sheet, and receives the Result Report — no Shopify admin interaction required.

## User Stories

1. As a merchant, I want to upload an Excel workbook and have variant prices updated in bulk, so that I don't have to update each variant manually in Shopify admin.
2. As a merchant, I want to upload an Excel workbook and have compare-at prices updated in bulk, so that I can run sales across many products at once.
3. As a merchant, I want to upload an Excel workbook and have cost-per-item updated in bulk, so that my margin reporting stays accurate after supplier price changes.
4. As a merchant, I want to use my existing Matrixify-format workbooks without reformatting, so that I don't have to maintain two separate spreadsheet schemas.
5. As a merchant, I want rows identified by Variant ID when available and SKU as fallback, so that I can work with both ID-based and SKU-based exports.
6. As a merchant, I want failed rows to be skipped and reported rather than stopping the entire batch, so that a single bad row doesn't block all my other updates.
7. As a merchant, I want a dry-run mode that shows me what would change without making any updates, so that I can validate my workbook before committing.
8. As a merchant, I want a Result Report showing total rows, successes, and each failed row with a reason, so that I can quickly identify and fix problems.
9. As a merchant, I want empty cells in my workbook to be ignored, so that I can include only the fields I want to change without accidentally blanking other fields.
10. As a merchant, I want rows with `Command = UPDATE` to fail if the variant is not found, so that I know when my lookup keys are stale.
11. As a merchant, I want rows with `Command = MERGE` to update existing variants, so that I have a forgiving mode for bulk operations where I'm less certain of exact IDs.
12. As a merchant, I want rows with unsupported Command values to be skipped and noted in the Result Report, so that I can use my full Matrixify workbook without stripping unsupported rows first.
13. As a merchant, I want to trigger the bulk update from Activepieces by uploading a file, so that I can integrate it into my existing operational workflows.
14. As a merchant, I want the worker to handle hundreds of rows within a reasonable time, so that large catalogue updates don't time out.
15. As a merchant, I want price and compare-at price updates grouped by product in a single mutation per product, so that updates are efficient and don't hit Shopify rate limits.
16. As a merchant, I want cost updates processed with controlled concurrency, so that the worker doesn't flood the Shopify API.
17. As a developer, I want Shopify credentials stored as Cloudflare Worker secrets, so that they are never exposed in source code or logs.
18. As a developer, I want the Excel parsing logic isolated from the Shopify mutation logic, so that each can be tested independently.
19. As a developer, I want the worker to return structured JSON for both success and error cases, so that Activepieces can parse and act on the result.
20. As a developer, I want the dry-run flag passed as a query parameter (`?dryRun=true`), so that it can be toggled without changing the request body.

## Implementation Decisions

### Runtime
Cloudflare Worker, TypeScript, deployed via Wrangler. Paid plan required for CPU time headroom with large batches.

### HTTP Interface
- `POST /bulk-update?sheet=<sheetName>&dryRun=<true|false>`
- Body: `multipart/form-data` with Excel file field
- Response: JSON Result Report

### Excel Parsing Module
Accepts raw Excel file bytes and a sheet name. Returns an array of parsed rows (typed records). Responsible for: sheet selection, column header mapping, empty-cell skipping, Command validation. No Shopify knowledge.

### Shopify Client Module
Wraps Shopify Admin GraphQL API. Exposes typed methods: `updateVariantPrices(productId, variants[])` and `updateVariantCost(inventoryItemId, cost)`. No Excel knowledge.

### Row Processor Module
Orchestrates a single row: resolves Lookup Key → fetches Shopify IDs if needed → dispatches to Shopify Client. Returns per-row success or failure result.

### Batch Orchestrator
Iterates all parsed rows. Groups price/compareAtPrice updates by product (one `productVariantsBulkUpdate` per product). Runs cost updates (`inventoryItemUpdate`) with concurrency limit of 5. Collects results into Result Report. In dry-run mode, skips all mutations and returns what would have changed.

### Lookup Key Resolution
1. If `Variant ID` present → use directly.
2. Else if `Variant SKU` present → query Shopify to resolve to Variant ID and parent Product ID.
3. Else → row fails with "no lookup key".

### Matrixify Column Mapping
| Excel Column | Shopify Field |
|---|---|
| `Variant ID` | Variant GID |
| `Variant SKU` | SKU (for lookup) |
| `Handle` | Product handle (informational) |
| `Variant Price` | `price` on Variant |
| `Variant Compare At Price` | `compareAtPrice` on Variant |
| `Variant Cost` | `unitCost` on InventoryItem |
| `Command` | Operation mode |

### Result Report Shape
```typescript
{
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ row: number; lookupKey: string; reason: string }>;
}
```

## Testing Decisions

Good tests verify external behavior only — given an Excel file (or parsed rows) and a mocked Shopify API, the correct mutations are called and the correct Result Report is returned. Tests should not assert on internal module calls or implementation sequence.

### Modules to test

**Excel Parsing Module** — unit tested with fixture `.xlsx` files. Assert correct row extraction, empty-cell skipping, unsupported Command filtering, and error on missing sheet name.

**Row Processor Module** — unit tested with a stubbed Shopify Client. Assert correct lookup key resolution priority (ID over SKU), correct field mapping, correct behavior for UPDATE vs MERGE commands, and correct error shape on lookup failure.

**Batch Orchestrator** — integration tested end-to-end with a stubbed Shopify Client. Assert grouping of variants by product, concurrency behavior for cost updates, dry-run produces no mutations, and Result Report counts are accurate.

No prior test art exists in this repo — establish the pattern with these three modules.

## Out of Scope

- CREATE operations (new products or variants)
- DELETE operations
- REPLACE operations
- Inventory quantity updates
- Image updates
- Metafield updates
- Multi-store support
- Authentication / authorization on the Worker endpoint (assumed internal/private URL)
- UI — all interaction is via Activepieces and the HTTP API

## Further Notes

- The Matrixify demo workbook (`Matrixify-Import-Demo-Products.xlsx`) in the repo root serves as the reference for column format and can be used as a test fixture.
- Cloudflare Workers free plan has a 10ms CPU time limit — paid plan (or Workers Paid) required for batch sizes in the hundreds.
- `inventoryItemUpdate` requires the `inventoryItemId`, which lives on the Variant. SKU-based lookups must fetch both `variantId` and `inventoryItemId` in a single query to avoid extra round trips.

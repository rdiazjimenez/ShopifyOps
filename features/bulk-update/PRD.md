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
5a. As a merchant, I want to update a variant's SKU when I provide its Variant ID, so that SKU corrections can be applied in the same bulk workflow.
5b. As a merchant, I want rows with no variant identifier but a Product ID or Handle to update product-level fields directly, so that I can bulk-update titles, vendors, and descriptions using a product-only export without needing variant IDs.
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
- `updateVariants(productId, variants[{ id, sku?, price?, compareAtPrice?, cost? }])` — single `productVariantsBulkUpdate` mutation. SKU and cost are passed via `inventoryItem: { sku?: <value>, cost?: <value> }` nested in the variant input. Omitted fields are not sent.
- `updateProduct(productId, input{ title?, descriptionHtml?, vendor?, productType?, tags?, status? })` — single `productUpdate` mutation. Only non-undefined fields included. Surfaces `userErrors`.
- `resolveVariantToProductId(variantGid)` → `productId` — queries `productVariant(id:) { product { id } }`; throws typed error if variant not found (`"Variant not found"`).
- `resolveSkuToIds(sku)` → `{ variantId, productId }` — uses `first: 2`; throws typed error on 0 results (`"SKU not found"`) or 2+ results (`"SKU matches multiple variants"`).
- `resolveHandleToProductId(handle)` → `productId` — queries `productByHandle`; throws typed error on null result (`"Handle not found"`).

No Excel knowledge. No separate `inventoryItemUpdate` mutation.

### Cost Mutation Approach
Cost is updated via `inventoryItem { cost }` nested inside `productVariantsBulkUpdate` — not via a separate `inventoryItemUpdate` call. This keeps price and cost in one mutation per product group, reducing API calls. Confirmed against Shopify `ProductVariantsBulkInput` schema which exposes `inventoryItem.cost`.

### Partial Update Behavior

**Decision: Option A — group-level failure (current implementation).**

When a product group has multiple variants and Shopify returns `userErrors`, all variants in that group are marked failed. Rationale: `productVariantsBulkUpdate` is atomic per call — no partial success is guaranteed. Treating the whole group as failed is safe and unambiguous. Individual variant resolution errors (lookup failure before mutation) do not affect other variants or other product groups.

**Future option (not implemented): Option B — per-row error mapping.**
Map `userErrors` back to individual variant rows using the field-path index (e.g. `["variants", "0", "price"]` → row at input index 0). This would give more precise Result Reports when only one variant in a product group has bad data. Requires verifying the `ProductUserError` schema fields (`field`, `message`, `code`) before implementing to confirm the index is stable and reliable. Deferred until a concrete merchant need arises.

### GID Normalization
`Variant ID` from Matrixify may be numeric (`123456`) or a full GID (`gid://shopify/ProductVariant/123456`). `ID` (Product ID) may be numeric (`789`) or a full GID (`gid://shopify/Product/789`). Normalize both to full GID before all API calls.

### Row Processor Module
Orchestrates a single row: resolves Lookup Key → dispatches fields to Shopify Client. Returns typed `ProcessedRow` (internal).

Resolution paths:
- Variant-path (Variant ID or SKU present) → resolves `(variantId, productId)`; eligible for both `productVariantsBulkUpdate` and `productUpdate`.
- Product-path (Product ID or Handle present, no variant identifier) → resolves `(productId only)`; eligible for `productUpdate` only. Fails immediately if any variant field is present.

No-op rows (valid lookup key + command, but no variant fields AND no product fields) → `skipped`, reason `"no fields to update"`.

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
1. `Variant ID` present → normalize to GID, use directly (no API call). Resolves to **(variantId, productId)** via `resolveVariantToProductId`.
2. `Variant ID` absent, `Variant SKU` present → call `resolveSkuToIds(sku)`. Resolves to **(variantId, productId)**.
3. Neither variant identifier present, `ID` (Product ID) present → normalize to product GID (no API call). Resolves to **(productId only)**. Note: existence is validated at mutation time by Shopify (`productUpdate` returns `userErrors` for an invalid GID); dry-run does not catch a non-existent Product ID.
4. None of the above, `Handle` present → call `resolveHandleToProductId(handle)`. Resolves to **(productId only)**.
5. No identifier present → fail row with reason `"no lookup key"`.

**Product-path validation:** if a row resolves via path 3 or 4 (productId only) but carries any variant field (`Variant Price`, `Variant Compare At Price`, `Variant Cost`, or `Variant SKU` when used as a replacement — i.e. `Variant ID` is present context does not apply here, but `Variant SKU` on a product-path row has no variant to update) → fail row with reason `"variant lookup key required for variant fields"`. Specifically: any of `price`, `compareAtPrice`, `cost`, or `sku` present on a product-path row triggers this failure.

SKU update semantics:
- `Variant ID` present + `Variant SKU` present → update that variant's SKU to the `Variant SKU` value.
- `Variant ID` absent + `Variant SKU` present → use `Variant SKU` only as lookup key.
Shopify stores SKU on the variant's InventoryItem, so the mutation sends SKU as `inventoryItem.sku`.

### Matrixify Column Mapping

**Lookup / identity columns**
| Excel Column | Role |
|---|---|
| `Command` | Operation mode |
| `ID` | Product GID (normalize from numeric) — product-path lookup key |
| `Handle` | Product handle — product-path lookup key (fallback after Product ID) |
| `Variant ID` | Variant GID (normalize from numeric) — variant-path lookup key |
| `Variant SKU` | SKU update when `Variant ID` present; variant-path lookup when absent |

**Variant fields** (require a variant identifier; ignored on product-path rows)
| Excel Column | Shopify Field |
|---|---|
| `Variant Price` | `price` on Variant |
| `Variant Compare At Price` | `compareAtPrice` on Variant |
| `Variant Cost` | `unitCost` via `inventoryItem.cost` in bulk mutation |

**Product fields** (written via `productUpdate`; First-Row only)
| Excel Column | Shopify Field |
|---|---|
| `Title` | `title` |
| `Body HTML` | `descriptionHtml` |
| `Vendor` | `vendor` |
| `Type` | `productType` |
| `Tags` | `tags` (behaviour controlled by `Tags Command`) |
| `Tags Command` | `MERGE` (default) unions with existing tags; `REPLACE` overwrites |
| `Status` | `status` (`active` / `draft` / `archived`, case-insensitive) |

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
- **Missing lookup key:** Row with no Variant ID, no SKU, no Product ID, and no Handle fails with reason `"no lookup key"`.
- **Product-path lookup:** Row with Product ID (no variant identifier) resolves to productId only; `productUpdate` fires, `productVariantsBulkUpdate` skipped.
- **Handle lookup:** Row with Handle (no variant identifier, no Product ID) resolves to productId only via `resolveHandleToProductId`; `productUpdate` fires, `productVariantsBulkUpdate` skipped.
- **Handle not found:** Row with Handle that does not exist in Shopify fails with reason `"Handle not found"`.
- **Variant fields on product-path:** Row with only Handle or Product ID (no variant identifier) that carries any of `Variant Price`, `Variant Compare At Price`, `Variant Cost`, or `Variant SKU` fails with reason `"variant lookup key required for variant fields"`.
- **Command checked before lookup:** Rows with unsupported `Command` values (`NEW`, `DELETE`, `REPLACE`, `IGNORE`, unknown) are skipped immediately — no lookup or API call is made. A row with `Command = NEW` and a non-existent Handle appears as `skipped`, not `failed "Handle not found"`.
- **Grouped mutation:** Variants belonging to the same product are sent in one `productVariantsBulkUpdate` call, not one call per variant.
- **Partial/userErrors:** Shopify `userErrors` on a product group marks all variants in that group as failed; other product groups are unaffected.
- **Combined mutation result:** When both `productUpdate` and `productVariantsBulkUpdate` fire for a product group, strictest outcome wins: if either returns `userErrors`, all rows in the group are `failed` with reasons concatenated.
- **Result Report invariants:** `total === succeeded + failed + skipped` and `rows.length === total` in all cases.
- **SKU update:** Row with `Variant ID` and `Variant SKU` updates the variant's SKU.
- **No-op row:** Row with valid command and lookup key but no variant fields (price, compareAtPrice, cost, sku) AND no product fields (title, bodyHtml, vendor, type, tags, status) appears as `skipped`, reason `"no fields to update"`.
- **Product-path First-Row Rule:** Only the first row per product (by resolved productId) contributes product fields to `productUpdate`. A later row for the same product that has **no variant fields** is `skipped`, reason `"duplicate product row"`. A later row for the same product that **has variant fields** (i.e. it's a variant row that also happens to carry product fields) is processed normally for its variant fields — its product field cells are simply ignored (consistent with the existing First-Row Rule for variant-path rows).

## Testing Decisions

Good tests verify external behavior only — given an Excel file (or parsed rows) and a stubbed Shopify API, the correct mutations are called and the correct Result Report is returned. Tests should not assert on internal module calls or implementation sequence.

### Modules to test

**Excel Parsing Module** — unit tested with fixture `.xlsx` files. Assert: correct row extraction, empty-cell skipping, unsupported Command skipping, missing sheet error, case-insensitive + trimmed header matching, duplicate header handling.

**Shopify Client Module** — unit tested with stubbed HTTP layer. Assert: single mutation carries sku + price + compareAtPrice + cost; omitted fields absent from variables; `userErrors` mapped correctly; SKU not found and SKU ambiguous both throw typed errors; numeric IDs normalized to GIDs.

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

- The Matrixify demo workbook (`ImportProducts-Demo.xlsx`) in the repo root serves as the reference for column format and is used as a test fixture.
- Cloudflare Workers free plan has a 10ms CPU time limit — paid plan required for batch sizes in the hundreds.
- Cost is updated via `inventoryItem { cost }` nested inside `productVariantsBulkUpdate` — no separate `inventoryItemUpdate` call. This was confirmed against the Shopify `ProductVariantsBulkInput` schema.
- Idempotency: the Result Report lets merchants safely re-run the same workbook after fixing errors — already-correct values are unchanged by the update.
- The `xlsx` CDN dependency on the frontend should be pinned to a specific version with a subresource integrity hash.

# PRD: Bulk Update — Products, Variants, Prices & Costs

## Problem Statement

Updating prices, compare-at prices, and costs across hundreds of Shopify variants is slow and error-prone when done manually through the Shopify admin. Merchants need to prepare changes in Excel (which they already do for planning and approval), then apply those changes to Shopify in bulk without re-entering data or relying on expensive third-party apps like Matrixify for every run.

## Solution

A Shopify Admin embedded app (Polaris UI, hosted on Vercel) that accepts an Excel Workbook upload, parses each row using Matrixify-compatible column format, and applies changes directly to the installed store via the Admin GraphQL API using the active session credentials. Returns a Result Report detailing per-row outcomes (success, failed, skipped). An optional dry-run mode lets users validate changes before committing them.

The embedded app is the primary and only actively-deployed path. Two legacy paths remain as frozen code in the repo — **Cloudflare Pages + Access** (browser UI, Google SSO, proxies to Worker) and **headless HTTP** (curl/API, `X-Api-Key` to Worker) — but neither is actively deployed or maintained. See ADR 0003.

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
12. As a merchant, I want rows with unsupported Command values (`DELETE`, `REPLACE`, `IGNORE`, and other unknown values) counted as skipped, so that I can use my full Matrixify workbook without stripping those rows first.
13. As a merchant, I want to open a browser UI, upload my workbook, and see results without writing code or using curl, so that I can operate the tool independently.
14. As a merchant, I want to download an Annotated Workbook after the operation with Status and Reason per row plus a Results summary sheet, so that I have a record and can fix failures in the same file.
15. As a merchant, I want the app to handle hundreds of rows within a reasonable time, so that large catalogue updates don't time out.
16. As a merchant, I want price, compare-at price, and cost updates grouped by product in a single mutation per product, so that updates are efficient and don't hit Shopify rate limits.
17. As a developer, I want the app to use the active Shopify session credentials automatically, so that no store domain or access token needs to be configured in Vercel env vars.
18. As a developer, I want the Excel parsing logic isolated from the Shopify mutation logic, so that each can be tested independently.
19. As a developer, I want the app action to return structured JSON for both success and error cases, so that the UI can parse and display results without crashing.
20. As a developer, I want the dry-run flag passed as a form field, so that it can be toggled without changing the file upload flow.
21. As a developer, I want unauthenticated requests to the app action to be rejected before any parsing or API calls occur, so that no work happens without a valid Shopify session.
22. As a developer, I want the `BulkUpdateShopifyClient` interface to abstract GraphQL transport, so that row processor and batch orchestrator can be tested in isolation with a mock client.

## Implementation Decisions

### Runtime
Vercel (Node.js), React Router (Remix). The embedded app is the only actively-deployed runtime. The frozen Cloudflare Worker remains in the repo for the legacy standalone paths but is not deployed. See ADR 0003.

### Shopify API Version
`2026-04`. Pinned in `InstalledShopifyClient`. Do not use `unstable` or `latest`.

### Required Shopify API Scopes
`write_products`, `read_products`, `write_inventory`, `read_inventory`.

Note: `write_inventory` is required because cost is updated via the `inventoryItem` input on `productVariantsBulkUpdate`, which writes to the InventoryItem record.

### Action Interface
- `POST` to React Router action on the index route
- Body: `multipart/form-data` — fields: `file` (xlsx blob), `sheet` (string), `dryRun` (boolean string)
- Response: JSON `ResultReport`

### Auth
`authenticate.admin(request)` from `@shopify/shopify-app-remix`. Unauthenticated requests are rejected before any parsing occurs. Session storage via Prisma + Neon Postgres.

### Excel Parsing Module
Accepts raw Excel file bytes and a sheet name. Returns an array of parsed rows (typed records). Column header matching is case-insensitive and whitespace-trimmed. Duplicate headers: last column wins. No Shopify knowledge.

### BulkUpdateShopifyClient Interface + InstalledShopifyClient
`BulkUpdateShopifyClient` is the TypeScript interface that abstracts Shopify Admin GraphQL transport. `InstalledShopifyClient` implements it using `admin.graphql()` from the active session. Responsibilities: update variants (price, compareAtPrice, cost, sku) in a single `productVariantsBulkUpdate` mutation per product group; update product fields via `productUpdate`; create new variants via `productVariantsBulkCreate`; resolve Variant ID / SKU / Handle / Product ID to internal IDs; surface typed errors for not-found and ambiguous-SKU cases. Omitted fields are never sent. No Excel knowledge. No separate `inventoryItemUpdate` mutation — cost travels via `inventoryItem.cost` inside the bulk variant mutation. SKU lookup uses exact field-scoped query (`sku:"..."`) with quote/backslash escaping.

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
- Product-path (Product ID or Handle present, no variant identifier) → resolves `(productId only)`; eligible for `productUpdate`. With `UPDATE`/`MERGE` + variant fields: auto-resolve if single variant, fail if multiple. With `NEW`: variant fields become create inputs, dispatched via `productVariantsBulkCreate`.

No-op rows (valid lookup key + command, but no variant fields AND no product fields) → `skipped`, reason `"no fields to update"`.

### Command Semantics
| Command | Behaviour |
|---|---|
| `UPDATE` | Update if found; fail if not found |
| `MERGE` | Update if found; fail if not found (create is out of scope) |
| `NEW` | Create new variant under the product identified by Product ID or Handle. `Variant SKU` is a field to set on the new variant — not a lookup key. Product must exist; no product creation. Uses `productVariantsBulkCreate`. Fail if no product lookup key (`"no lookup key"`). |
| `DELETE`, `REPLACE`, `IGNORE`, other | Skip row |

### Batch Orchestrator
Groups rows by product. Per product group: one `productVariantsBulkUpdate` call for `UPDATE`/`MERGE` variant rows; one `productVariantsBulkCreate` call for `NEW` rows; one `productUpdate` call if product fields present (First-Row only). Collects outcomes into Result Report.

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

**Product-path + variant fields:** if a row resolves via path 3 or 4 (productId only, `Command` is `UPDATE`/`MERGE`) and carries variant fields (`Variant Price`, `Variant Compare At Price`, `Variant Cost`, or `Variant SKU`):
- Product has **exactly one variant** → auto-resolve that variant via `resolveProductToSingleVariantId`; proceed as a variant-path row.
- Product has **two or more variants** → fail row with reason `"Product has multiple variants — Variant ID required"`.

`NEW` command exception: variant fields on a `NEW` product-path row are create inputs, not subject to this rule.

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

**Variant fields** (variant-path, single-variant product-path, or `NEW` create inputs)
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

### Frontend (Shopify Admin Embedded App)
React Router app hosted on Vercel, embedded inside Shopify Admin via a custom distribution app registered in Shopify Partners (single store, no App Review). Polaris components + App Bridge provide native Admin chrome. `@shopify/shopify-app-remix` handles OAuth and session token validation. Sessions stored in Vercel Postgres (Neon free tier) via Prisma.

The React Router `action` calls `authenticate.admin(request)` and runs the Bulk Operation directly — no proxy to the Worker. Business logic (excel parser, row processor, batch orchestrator) lives in `app/services/bulk-update/`. The `BulkUpdateShopifyClient` interface abstracts GraphQL transport; `InstalledShopifyClient` implements it using `admin.graphql()`. No `WORKER_URL`, `API_KEY`, `SHOPIFY_STORE_DOMAIN`, or `SHOPIFY_ACCESS_TOKEN` env vars are required by the app.

UI capabilities: file picker, client-side sheet dropdown (SheetJS npm package), dry-run toggle, submit, loading state, Result Report display, client-side Annotated Workbook download.

## Acceptance Criteria

- **Missing sheet:** Sheet name not found in workbook returns an action error with descriptive message.
- **Dry run:** `dryRun=true` form field returns Result Report with zero mutations sent to Shopify.
- **Skipped commands:** Rows with `Command = DELETE/REPLACE/IGNORE` appear in `rows[]` with `status: "skipped"`. No lookup or API call is made.
- **NEW — creates variant:** Row with `Command = NEW` and a valid Product ID or Handle creates a new variant via `productVariantsBulkCreate`; `Variant SKU` is set as a field on the new variant, not used as a lookup key.
- **NEW — no product key:** Row with `Command = NEW` and no Product ID and no Handle fails with reason `"no lookup key"`.
- **NEW — SKU not used as lookup:** Row with `Command = NEW`, no Product ID, no Handle, but a `Variant SKU` value fails with `"no lookup key"` — SKU is never a lookup key for `NEW` rows.
- **Duplicate SKU:** SKU matching 2+ variants fails that row with reason `"SKU matches multiple variants"`.
- **Missing lookup key:** Row with no Variant ID, no SKU, no Product ID, and no Handle fails with reason `"no lookup key"`.
- **Product-path lookup:** Row with Product ID (no variant identifier) resolves to productId only; `productUpdate` fires, `productVariantsBulkUpdate` skipped.
- **Handle lookup:** Row with Handle (no variant identifier, no Product ID) resolves to productId only via `resolveHandleToProductId`; `productUpdate` fires, `productVariantsBulkUpdate` skipped.
- **Handle not found:** Row with Handle that does not exist in Shopify fails with reason `"Handle not found"`.
- **Variant fields on product-path — single variant:** Row with only Handle or Product ID (no variant identifier, `UPDATE`/`MERGE` command) that carries variant fields and the product has exactly one variant → auto-resolved; processes as variant-path row.
- **Variant fields on product-path — multiple variants:** Same scenario but product has two or more variants → fails with reason `"Product has multiple variants — Variant ID required"`.
- **Command checked before lookup:** Rows with `DELETE`, `REPLACE`, `IGNORE`, or unknown `Command` values are skipped immediately — no lookup or API call is made.
- **Grouped mutation:** Variants belonging to the same product are sent in one `productVariantsBulkUpdate` call, not one call per variant.
- **Partial/userErrors:** Shopify `userErrors` on a product group marks all variants in that group as failed; other product groups are unaffected.
- **Combined mutation result:** When both `productUpdate` and `productVariantsBulkUpdate` fire for a product group, strictest outcome wins: if either returns `userErrors`, all rows in the group are `failed` with reasons concatenated.
- **Shopify app — unauthenticated rejected:** Request to the React Router action without a valid Shopify session is rejected before any parsing or API calls occur.
- **Shopify app — direct execution:** Valid Shopify session results in the action running business logic directly via `admin.graphql()`; no outbound request to the Worker.
- **Shopify app — no Worker env vars:** `WORKER_URL`, `API_KEY`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN` are absent from the app's required env vars.
- **Result Report invariants:** `total === succeeded + failed + skipped` and `rows.length === total` in all cases.
- **SKU update:** Row with `Variant ID` and `Variant SKU` updates the variant's SKU.
- **No-op row:** Row with valid command and lookup key but no variant fields (price, compareAtPrice, cost, sku) AND no product fields (title, bodyHtml, vendor, type, tags, status) appears as `skipped`, reason `"no fields to update"`.
- **Product-path First-Row Rule:** Only the first row per product (by resolved productId) contributes product fields to `productUpdate`. A later row for the same product that has **no variant fields** is `skipped`, reason `"duplicate product row"`. A later row for the same product that **has variant fields** (i.e. it's a variant row that also happens to carry product fields) is processed normally for its variant fields — its product field cells are simply ignored (consistent with the existing First-Row Rule for variant-path rows).

## Testing Decisions

Good tests verify external behavior only — given an Excel file (or parsed rows) and a stubbed Shopify API, the correct mutations are called and the correct Result Report is returned. Tests should not assert on internal module calls or implementation sequence.

**Behavioral boundary for Shopify Client stubs:** mutation methods (`updateVariants`, `updateProduct`, `createVariants`, `fetchProductTags`) are observable external behavior — asserting on them is permitted. Lookup/resolution methods (`resolveVariantToProductId`, `resolveSkuToIds`, `resolveHandleToProductId`, `resolveProductToSingleVariantId`) are internal implementation details — do not assert on whether or how they are called. Test the result shape (`type`, `productId`, `lookupKey`, `variantInput`, `productPath`) instead.

### Modules to test

**Excel Parsing Module** — unit tested with fixture `.xlsx` files. Assert: correct row extraction, empty-cell skipping, unsupported Command skipping, missing sheet error, case-insensitive + trimmed header matching, duplicate header handling.

**`InstalledShopifyClient`** — unit tested with mocked `admin.graphql`. Assert: single mutation carries sku + price + compareAtPrice + cost; omitted fields absent from variables; `userErrors` mapped correctly; SKU not found and SKU ambiguous both throw typed errors; numeric IDs normalized to GIDs; SKU lookup uses exact field-scoped query (`sku:"..."`). Prior art: worker's `shopify-client.test.ts`.

**Row Processor Module** — unit tested with stubbed Shopify Client. Assert: Variant ID takes precedence over SKU; no-op row returns `skipped`; UPDATE/MERGE both fail when variant not found; `NEW` command dispatches create and ignores SKU as lookup key; single-variant auto-resolve promotes product-path row to variant-path; correct shape returned.

**Batch Orchestrator** — integration tested with stubbed Shopify Client and real Excel fixture. Assert: grouping by product; dry-run sends zero mutations; `rows.length === total`; `status` correct per outcome; `reason` present on failed/skipped, absent on success.

Prior art: `excel-parser.test.ts`, `shopify-client.test.ts`, `row-processor.test.ts`, `batch-orchestrator.test.ts` establish the pattern.

## Out of Scope

- New product creation (variants only via `Command = NEW`)
- DELETE operations
- REPLACE operations
- Inventory quantity updates
- Image updates
- Metafield updates
- Channel visibility / publication updates
- Multi-store support
- Money format validation (delegated to Shopify; invalid formats return `userErrors`)
- Chunking / streaming for very large batches (revisit if hit in practice)
- Shared npm package / monorepo extraction of business logic between app and frozen Worker
- Any changes to the frozen Worker or `frontend-pages/` source
- Cloudflare infrastructure (Worker and Pages paths are frozen, not deployed)

## Further Notes

- The Matrixify demo workbook (`ImportProducts-Demo.xlsx`) serves as the reference for column format and is used as a test fixture.
- Cost is updated via `inventoryItem { cost }` nested inside `productVariantsBulkUpdate` — no separate `inventoryItemUpdate` call. Confirmed against the Shopify `ProductVariantsBulkInput` schema.
- Idempotency: the Result Report lets merchants safely re-run the same workbook after fixing errors — already-correct values are unchanged by the update.
- The `xlsx` npm package in the app should be kept at a pinned version.

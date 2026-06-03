# Bulk Update — Domain Glossary

## Terms

### Product
A Shopify product entity. Has one or more Variants. Managed via Shopify Admin GraphQL API.

### Variant
A specific purchasable version of a Product (e.g. size/color combination). Carries its own price and inventory.

### Price
The monetary value assigned to a Variant. Stored as a decimal string in Shopify (e.g. "19.99"). Includes `price` and `compareAtPrice`.

### Cost
The cost of goods for a Variant. Stored on `InventoryItem.unitCost`. Updated via the `inventoryItem.cost` field nested inside `productVariantsBulkUpdate` — no separate `inventoryItemUpdate` mutation. Requires `write_inventory` scope.

### Bulk Operation
A user-initiated action that updates up to hundreds of Variant records in a single execution. Driven by data from an Excel Workbook. Scope: update-only (no create or delete). Rows are processed independently — a failed row is skipped and logged; remaining rows continue. Returns a Result Report.

### Result Report
The response from a Bulk Operation. Contains: `total`, `succeeded`, `failed`, `skipped` counts, and `rows[]` — one entry per processed row with `row` number, `lookupKey`, `status` (`success` | `failed` | `skipped`), and `reason` (present on failed and skipped rows). `total === succeeded + failed + skipped`. The frontend uses `rows[]` to annotate the downloaded Excel Workbook.

### Dry Run
Optional mode (`?dryRun=true`) where rows are validated and API calls are simulated but no mutations are sent to Shopify. Returns a Result Report showing what would have changed.

### Excel Workbook
The source of truth for bulk operation data. Follows Matrixify column format. Each row represents one Variant record. Empty cell = skip that field. Key columns: `Handle`, `Variant ID`, `Variant SKU`, `Command`, `Variant Price`, `Variant Compare At Price`, `Variant Cost`.

### Command
Per-row instruction column (Matrixify format). `UPDATE`: update if found, fail if not found. `MERGE`: update if found, fail if not found (create is out of scope). Other values (`NEW`, `DELETE`, `REPLACE`, `IGNORE`, unknown) → row skipped.

### Lookup Key
The identifier used to match an Excel row to a Shopify Variant. Variant ID takes precedence; SKU is used as fallback when Variant ID is absent.

### Shopify API
Shopify Admin GraphQL API, version `2026-04`. Pinned in the Shopify Client Module (`shopify-client.ts`) and `wrangler.toml`. Do not use `unstable` or `latest`. Required scopes: `write_products`, `read_products`, `write_inventory`, `read_inventory`. `write_inventory` is needed because cost is stored on `InventoryItem` and updated via `inventoryItem.cost` inside `productVariantsBulkUpdate`.

### Store Credentials
Single Shopify store. Admin API token stored as Cloudflare Worker secret (`SHOPIFY_ACCESS_TOKEN`). Store domain stored as `SHOPIFY_STORE_DOMAIN`.

### Frontend
A UI layer that lets a user upload an Excel Workbook, select a sheet from a dropdown (populated client-side), toggle Dry Run, submit the Bulk Operation, view a Result Report (summary card + per-row table), and download an annotated copy of the workbook. Three flavors, each in its own directory under `features/bulk-update/`:

| Directory | Flavor | Auth | CF Project |
|---|---|---|---|
| `worker/` | Headless — triggered via curl/HTTP | `X-Api-Key` header | `shopifyops-bulk-update` |
| `frontend-pages/` | Cloudflare Pages + Cloudflare Access | Google SSO (single merchant) | `shopifyops-bulk-update-ui` |
| `frontend-shopify-app/` | Shopify Admin embedded app | Shopify session token | — |

Flavors share the same `worker/` backend. Developed independently; each merges to `main` when complete.

### Pages Function
A server-side Cloudflare Pages Function (`frontend-pages/functions/api/bulk-update.js`) that proxies requests from the frontend to the worker. Adds the `X-Api-Key` header from the `API_KEY` Pages secret. The worker URL is set via `WORKER_URL` environment variable on the Pages project. The `API_KEY` is never sent to the browser.

### Annotated Workbook
The downloaded output of a Bulk Operation via the Frontend. A copy of the uploaded Excel Workbook with two columns appended to the processed sheet (`Status`, `Reason`) and a new `Results` sheet containing the summary counts. Generated client-side from the Result Report.

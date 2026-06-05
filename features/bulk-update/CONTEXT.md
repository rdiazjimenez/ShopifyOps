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
A user-initiated action that updates up to hundreds of records in a single execution. Driven by data from an Excel Workbook. Scope: update-only (no create or delete). Updates two scopes independently per product: Product Fields (once, from the First-Row) and Variant fields (once per variant row). Rows are processed independently — a failed row is skipped and logged; remaining rows continue. Returns a Result Report.

### Result Report
The response from a Bulk Operation. Contains: `total`, `succeeded`, `failed`, `skipped` counts, and `rows[]` — one entry per processed row with `row` number, `lookupKey`, `status` (`success` | `failed` | `skipped`), and `reason` (present on failed and skipped rows). `total === succeeded + failed + skipped`. The frontend uses `rows[]` to annotate the downloaded Excel Workbook.

### Dry Run
Optional mode (`?dryRun=true`) where rows are validated and API calls are simulated but no mutations are sent to Shopify. Returns a Result Report showing what would have changed.

### Excel Workbook
The source of truth for bulk operation data. Follows Matrixify column format. Each row represents one Variant record and optionally carries Product Fields for the parent product. Empty cell = skip that field.

Key columns — variant: `Handle`, `ID`, `Variant ID`, `Variant SKU`, `Command`, `Variant Price`, `Variant Compare At Price`, `Variant Cost`. Key columns — product: `Title`, `Body HTML`, `Vendor`, `Type`, `Tags`, `Tags Command`, `Status`.

`ID` is the Shopify Product ID (numeric or full GID). Used as a product-path lookup key when no variant identifier is present.

`Variant SKU` is treated as a **lookup key** only when Handle, Product ID, and Variant ID are all absent from the row. When Handle, Product ID, or Variant ID is present, `Variant SKU` becomes a field to set on the variant (replacement SKU), not a lookup key. When `Command` is `NEW`, `Variant SKU` is always a field to set on the new variant (never a lookup key).

### Command
Per-row instruction column (Matrixify format). `UPDATE`: update if found, fail if not found. `MERGE`: update if found, fail if not found. `NEW`: create a new variant on the product identified by Handle or Product ID — requires at least one variant field; fails with `"NEW command requires at least one variant field"` if no variant fields present; uses `productVariantsBulkCreate`. Blank cell: treated as `MERGE` (matches Matrixify's default). Other values (`DELETE`, `REPLACE`, `IGNORE`, unknown) → row skipped.

### Product Fields
The set of product-level fields updated by a Bulk Operation via a single `productUpdate` mutation. Tier 1 (in scope): `Title`, `Body HTML` (`descriptionHtml`), `Vendor`, `Type` (`productType`), `Tags`, `Status`. Tier 2+ (out of scope: Published/channel visibility, Images, Collections, Category, Options, Metafields).

A row contributes Product Fields only if it is the First-Row for its product. Empty cells are skipped — only non-empty Product Fields are included in the mutation input.

`Status` accepted values: `active`, `draft`, `archived` (case-insensitive; mapped to Shopify enum `ACTIVE` / `DRAFT` / `ARCHIVED`).

### Tags Command
Per-row column (`Tags Command`) controlling how `Tags` are applied. `MERGE` (default, including empty): fetches existing tags first and unions them with the Excel value — non-destructive, matches Matrixify's default. `REPLACE`: overwrites all existing tags with the Excel value — faster but destructive. Other values treated as `MERGE`.

Note: Matrixify supports Tags on multiple rows for the same product (each with its own `Tags Command`, executed in order). This system diverges: Tags are read only from the first row of each product (see First-Row Rule).

### First-Row Rule
When a product spans multiple rows in the Excel Workbook, Product Fields are read only from the first row encountered for that product. Subsequent rows for the same product are treated as variant-only and their Product Field cells are ignored. This prevents redundant `productUpdate` mutations and matches Matrixify's own convention.

For product-path rows (identified by Product ID or Handle, no variant): a later duplicate row with no variant fields is `skipped` with reason `"duplicate product row"`. A later row that has variant fields is processed normally for those fields — product field cells are still ignored.

### Lookup Key
The identifier used to match an Excel row to a Shopify record. Priority chain: **Handle → Product ID → Variant ID → Variant SKU → fail `"no lookup key"`**.

**Handle** — first priority. Calls `resolveHandleToProductId` to obtain the Shopify product ID. Empty or whitespace-only Handle is treated as absent.

**Product ID** — second priority, when Handle is absent. Normalised to a full GID (`gid://shopify/Product/<id>`) without an API call.

**Combined Handle+VariantID and ProductID+VariantID paths**: when Handle or Product ID is the anchor and `Variant ID` is also present on the same row, `Variant ID` is used directly to target the specific variant — no `resolveProductToSingleVariantId` call is made. This enables multi-variant products to be targeted using the natural Matrixify export format (Handle + Variant ID both present).

**Standalone Variant ID** — third priority, when neither Handle nor Product ID is present. Calls `resolveVariantToProductId` to obtain the product ID.

**Variant SKU** — last-resort lookup key, only when Handle, Product ID, and Variant ID are all absent. Calls `resolveSkuToIds`.

Full priority chain: Handle → Product ID → Variant ID → Variant SKU → fail `"no lookup key"`.

**`NEW` command exception**: For `NEW` rows, `Variant SKU` is never used as a lookup key. The priority chain collapses to Handle → Product ID → fail `"no lookup key"`. Variant fields (including `Variant SKU`) become create inputs, not lookup keys.

A row where Handle or Product ID is the anchor but no Variant ID is present, with `UPDATE`/`MERGE` command and variant fields: if the product has exactly one variant, the system auto-resolves that variant ID via `resolveProductToSingleVariantId` and proceeds as a variant-path row. If the product has multiple variants, fails with `"Product has multiple variants — Variant ID required"`. With `NEW` command, variant fields are allowed and trigger `productVariantsBulkCreate`.

### BulkUpdateShopifyClient
A TypeScript interface that abstracts Shopify Admin GraphQL transport for the Bulk Operation. Defines the methods needed by the row processor and batch orchestrator: `resolveVariantToProductId`, `resolveSkuToIds`, `resolveProductToSingleVariantId`, `resolveHandleToProductId`, `fetchProductTags`, `updateVariants`, `updateProduct`, `createVariants`. Two implementations exist: the embedded app's `InstalledShopifyClient` (backed by `admin.graphql()`) and the frozen worker's `ShopifyClient` (backed by `fetch` with env var credentials).

### Shopify API
Shopify Admin GraphQL API, version `2026-04`. Pinned in the Shopify Client Module (`shopify-client.ts`) and `wrangler.toml`. Do not use `unstable` or `latest`. Required scopes: `write_products`, `read_products`, `write_inventory`, `read_inventory`. `write_inventory` is needed because cost is stored on `InventoryItem` and updated via `inventoryItem.cost` inside `productVariantsBulkUpdate`.

### Store Credentials
Single Shopify store. Two credential sources depending on path:

- **Embedded app path:** Credentials come from the active Shopify session via `authenticate.admin(request)`. No env vars for store domain or access token — the session carries the installed store's token automatically.
- **Standalone worker path (legacy):** Admin API token stored as Cloudflare Worker secret (`SHOPIFY_ACCESS_TOKEN`). Store domain stored as `SHOPIFY_STORE_DOMAIN`. This path is frozen; see ADR 0003.

### Frontend
A UI layer that lets a user upload an Excel Workbook, select a sheet from a dropdown (populated client-side), toggle Dry Run, submit the Bulk Operation, view a Result Report (summary card + per-row table), and download an annotated copy of the workbook. Three flavors, each in its own directory under `features/bulk-update/`:

| Directory | Flavor | Auth | CF Project |
|---|---|---|---|
| `worker/` | Headless — triggered via curl/HTTP | `X-Api-Key` header | `shopifyops-bulk-update` |
| `frontend-pages/` | Cloudflare Pages + Cloudflare Access | Google SSO (single merchant) | `shopifyops-bulk-update-ui` |
| `frontend-shopify-app/` | Shopify Admin embedded app | Shopify session token | Vercel |

The embedded app (`frontend-shopify-app/`) runs business logic directly and does not call the worker. The worker and `frontend-pages/` are frozen legacy paths — code is available in the repo but not actively deployed. See ADR 0003.

### Pages Function
A server-side Cloudflare Pages Function (`frontend-pages/functions/api/bulk-update.js`) that proxies requests from the frontend to the worker. Adds the `X-Api-Key` header from the `API_KEY` Pages secret. The worker URL is set via `WORKER_URL` environment variable on the Pages project. The `API_KEY` is never sent to the browser. **This path is frozen and not actively deployed.** See ADR 0003.

### Shopify App Action
A React Router `action` function inside `frontend-shopify-app/` that authenticates via `authenticate.admin(request)`, then executes the Bulk Operation directly using the installed store's Admin GraphQL client. No proxy to the worker. Business logic lives in `app/services/bulk-update/` (ported from the worker). Returns the same `ResultReport` shape. See ADR 0003.

### Shopify Embedded App
The `frontend-shopify-app/` flavor. A React Router app scaffolded from the Shopify React Router template, hosted on Vercel. Registered as a **custom distribution app** in Shopify Partners (single-store, no App Review). Uses Polaris components and App Bridge for native Admin chrome. Session storage via Prisma + Vercel Postgres (Neon free tier). Scopes: `read_products`, `write_products`, `read_inventory`, `write_inventory`. Excel sheet-name preview and annotated workbook download are both client-side via SheetJS npm package.

### Annotated Workbook
The downloaded output of a Bulk Operation via the Frontend. A copy of the uploaded Excel Workbook with two columns appended to the processed sheet (`Status`, `Reason`) and a new `Results` sheet containing the summary counts. Generated client-side from the Result Report.

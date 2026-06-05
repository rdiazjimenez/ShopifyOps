## Problem Statement

The Shopify embedded app currently proxies every bulk update request to a Cloudflare Worker. The worker holds the Shopify store credentials (`SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_STORE_DOMAIN`) as static env vars for a single hardcoded store. The embedded app must carry `WORKER_URL` and `API_KEY` env vars to reach the worker.

This creates an unnecessary infrastructure dependency: normal operation requires both Vercel (app) and a deployed Cloudflare Worker. But the embedded app already holds a live Admin API session for the installed store via `authenticate.admin(request)` — routing through the worker means indirecting through a second service to re-authenticate to the same store.

## Solution

Move the Bulk Operation execution into the embedded app itself. The app action authenticates via `authenticate.admin(request)`, then runs excel parsing, row processing, and batch orchestration directly against the installed store's Admin GraphQL client. The Cloudflare Worker and `frontend-pages/` become frozen legacy paths — code remains in the repo but neither is actively deployed.

After this change, normal operation requires only Vercel and Neon. No Cloudflare dependency.

## User Stories

1. As the store owner using the Shopify embedded app, I want the bulk update to work without any Cloudflare Worker being deployed, so that I can operate the app with fewer moving parts.
2. As the store owner, I want the app to use my active Shopify session credentials automatically, so that I never have to configure `SHOPIFY_STORE_DOMAIN` or `SHOPIFY_ACCESS_TOKEN` env vars in Vercel.
3. As the store owner, I want `WORKER_URL` and `API_KEY` removed from the app's required env vars, so that the deployment config is simpler.
4. As the store owner, I want the bulk update result (Result Report, annotated workbook download) to be identical to what it was before, so that my workflow is unchanged.
5. As the store owner, I want dry-run mode to continue working exactly as before, so that I can validate my spreadsheet before committing changes.
6. As the store owner, I want per-row error reporting to continue working, so that I know exactly which rows failed and why.
7. As a developer setting up the app, I want `.env.example` to reflect only the env vars actually needed, so that I do not configure secrets for services the app no longer calls.
8. As a developer, I want the `BulkUpdateShopifyClient` interface to be the abstraction boundary between transport and business logic, so that the row processor and batch orchestrator can be tested in isolation without a real Shopify API.
9. As a developer, I want the excel parser, row processor, and batch orchestrator ported unchanged from the worker, so that behavior is identical and test coverage transfers directly.
10. As a developer, I want the worker code to remain in the repository in a clearly frozen state, so that the standalone curl/frontend-pages path can be revived if ever needed.
11. As a developer who might revive the worker path, I want the ADR to document the revival contract explicitly, so that I know I am responsible for syncing any logic changes made to the app since the freeze.
12. As a developer, I want unauthenticated requests to the app action to be rejected before any parsing or API calls occur, so that no work happens without a valid Shopify session.
13. As a developer, I want Shopify GraphQL errors from the Admin API to surface as clean action errors in the Result Report, so that the UI can display them without crashing.
14. As a developer, I want missing file or sheet validation errors to return the same shape as before, so that the UI error handling is unchanged.

## Implementation Decisions

### Modules to build or modify

**New: `InstalledShopifyClient`**
Implements the `BulkUpdateShopifyClient` interface using the `admin.graphql()` function provided by `authenticate.admin(request)`. Wraps the same GraphQL queries and mutations as the frozen worker's `ShopifyClient`. Same method signatures: `resolveVariantToProductId`, `resolveSkuToIds`, `resolveProductToSingleVariantId`, `resolveHandleToProductId`, `fetchProductTags`, `updateVariants`, `updateProduct`, `createVariants`.

**Ported (unchanged logic): excel parser, row processor, batch orchestrator**
The three core business logic modules are ported from the worker into `app/services/bulk-update/` inside the Shopify app. No logic changes — only the import of the Shopify client is swapped from the worker's concrete class to the `BulkUpdateShopifyClient` interface. The `BulkUpdateShopifyClient` interface is extracted from the worker's `ShopifyClient` class as the canonical contract.

**Modified: app action (`app._index.tsx`)**
The `action` function stops calling `proxyToWorker()`. Instead it:
1. Calls `authenticate.admin(request)` — rejects if unauthenticated.
2. Reads the uploaded file and sheet name from `FormData`.
3. Calls the ported excel parser.
4. Instantiates `InstalledShopifyClient` with `admin.graphql`.
5. Calls the ported batch orchestrator.
6. Returns the `ResultReport` JSON — same shape as before.

**Deleted: `proxy.server.ts`**
No longer needed. Its tests are also removed or replaced by action-level tests.

**Modified: `.env.example`**
Remove `WORKER_URL` and `API_KEY`. Retain and annotate required Shopify app platform vars: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`.

### Interface contract
`BulkUpdateShopifyClient` is the boundary between transport and business logic. Row processor and batch orchestrator receive it as a parameter — they never instantiate a concrete client. This makes unit testing possible by passing a mock implementation.

### Worker freeze
Worker code is not modified. A note is added to `worker/README.md` marking it frozen and pointing to ADR 0003. No Cloudflare deployment is maintained.

### Behavior parity
The `ResultReport` shape, dry-run behavior, First-Row Rule, lookup key priority chain, and annotated workbook download are all unchanged. The UI requires zero modifications.

## Testing Decisions

Good tests verify external behavior through the public interface, not implementation details. They do not assert on internal state, private methods, or which concrete class was instantiated.

**Modules to test:**

- **`InstalledShopifyClient`** — unit tests with a mocked `admin.graphql` function. Verify each method sends the correct GraphQL query/mutation and correctly maps the response to the expected return type. Existing worker `shopify-client.test.ts` is the prior art and test structure reference.

- **App action (`app._index.tsx`)** — integration-style tests with mocked `authenticate.admin` and mocked `InstalledShopifyClient`. Verify: unauthenticated request is rejected before any parsing; authenticated dry-run returns a valid Result Report; SKU lookup sends exact `sku:"test-sku"` query through the client; missing file returns validation error; missing sheet returns validation error; Shopify GraphQL errors surface as clean action errors. Existing `app._index.test.ts` is the prior art.

- **Excel parser, row processor, batch orchestrator** — existing worker tests (`excel-parser.test.ts`, `row-processor.test.ts`, `batch-orchestrator.test.ts`) are ported alongside the source files. No new test logic needed — behavior is unchanged.

**Not tested:** `proxy.server.ts` (deleted), worker modules (frozen, not maintained).

## Out of Scope

- Shared npm package / monorepo extraction of business logic.
- Any changes to `frontend-pages/` or the Cloudflare Worker source.
- Changes to the Result Report shape or UI components.
- Tier 2+ product fields (Images, Collections, Metafields, etc.).
- Multi-store support — the app remains single-store (custom distribution).
- Migrating session storage away from Neon/Postgres.
- Any Cloudflare infrastructure changes.

## Further Notes

ADR 0002 ("Shopify app action proxies to worker") is superseded by ADR 0003 ("Embedded app runs business logic directly; worker and frontend-pages are frozen legacy"), which has been written and committed. CONTEXT.md has been updated to reflect the new `Store Credentials`, `Shopify App Action`, `BulkUpdateShopifyClient`, and `Frontend` definitions.

If the worker or `frontend-pages/` path is ever revived, the reviver is responsible for syncing all logic changes made to the app since ADR 0003 was written.

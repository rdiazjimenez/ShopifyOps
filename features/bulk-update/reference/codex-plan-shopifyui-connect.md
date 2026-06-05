# Connect Bulk Update To Installed Shopify Store

## Summary
- Move embedded app upload execution into the Shopify Remix app action.
- Use `authenticate.admin(request)` as source of truth for shop + Admin API access.
- Stop using `WORKER_URL`, `API_KEY`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN` for embedded app uploads.
- Keep Worker/frontend-pages as legacy standalone, not used by Shopify app.

## Key Changes
- In `app._index.tsx`, replace `proxyToWorker()` flow with:
  - authenticate request
  - read uploaded workbook
  - parse selected sheet
  - run batch directly with installed-shop Admin GraphQL client
  - return same `ResultReport` JSON shape
- Add app-local server bulk modules under `frontend-shopify-app/app/services/bulk-update/`:
  - parser/orchestrator/row processor ported from Worker
  - `InstalledShopifyClient` matching existing client interface
  - GraphQL transport uses `admin.graphql(query, { variables })`
- Remove embedded app dependency on `app/utils/proxy.server.ts`; delete or leave unused after tests updated.
- Update `.env.example`:
  - remove `WORKER_URL`
  - remove app-side `API_KEY`
  - note Shopify app still needs standard runtime envs: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`.

## Existing Implementations
- Worker remains standalone single-store API for now.
- `frontend-pages` remains standalone UI for Worker.
- Document both as legacy/manual path requiring Worker secrets.
- Shopify embedded app becomes the primary path and always targets installed store.

## Test Plan
- Frontend app route tests:
  - unauthenticated request does not parse or call Admin API
  - authenticated dry run returns success using mocked `admin.graphql`
  - SKU lookup sends exact `sku:"test-sku"` query through installed Admin client
  - missing file/sheet returns existing validation errors
  - Shopify GraphQL errors return clean action error
- Port/adapt core Worker tests for app-local services:
  - parser behavior unchanged
  - row processing lookup precedence unchanged
  - batch dry-run and mutation behavior unchanged
- Run:
  - `npm test` in `features/bulk-update/frontend-shopify-app`
  - `npm run build` or `npm run typecheck` if available

## Assumptions
- “Don’t depend on env variables” means store/token/proxy envs, not mandatory Shopify app platform envs.
- Neon/Postgres session storage stays for now because Shopify OAuth sessions need persistent storage.
- No Cloudflare/Vercel Worker env is needed for embedded app uploads after this change.

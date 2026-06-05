# ADR 0003 — Embedded app runs business logic directly; worker and frontend-pages are frozen legacy

## Status
Accepted — supersedes ADR 0002

## Context
ADR 0002 decided that `frontend-shopify-app/` proxies all bulk update work to the Cloudflare Worker, keeping the worker as the single source of business logic.

This required the app to carry `WORKER_URL` and `API_KEY` env vars, and the worker to carry `SHOPIFY_ACCESS_TOKEN` and `SHOPIFY_STORE_DOMAIN` secrets — a static credential pair for a single hardcoded store. The embedded app already holds a live session for the installed store via `authenticate.admin(request)`. Routing through the worker meant indirecting through a second service to re-authenticate to the same store.

As the Shopify embedded app became the primary and only actively-used path, the proxy pattern introduced unnecessary infrastructure dependency (Cloudflare Worker deployed and operational) for normal operation.

## Decision
The `frontend-shopify-app/` action function calls `authenticate.admin(request)` and runs the Bulk Operation directly using `admin.graphql()`. Business logic (excel parser, row processor, batch orchestrator) is ported into `app/services/bulk-update/`. A `BulkUpdateShopifyClient` interface abstracts the GraphQL transport; the app implements it via `admin.graphql()`.

The Cloudflare Worker and `frontend-pages/` are frozen: their code remains in the repository for reference or future revival, but they are not actively deployed and receive no maintenance. Bug fixes go to the app path only. If the worker path is ever revived, it must re-implement `BulkUpdateShopifyClient` using env var credentials and re-sync any logic changes made to the app since this ADR.

## Consequences
- Normal operation requires only Vercel and Neon — no Cloudflare dependency.
- `WORKER_URL`, `API_KEY`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN` are removed from app env vars.
- Business logic exists in two places (app services + frozen worker). Divergence is accepted: the worker copy is a snapshot, not a maintained implementation.
- If the worker or `frontend-pages/` path is revived, the reviver is responsible for syncing logic from the app.

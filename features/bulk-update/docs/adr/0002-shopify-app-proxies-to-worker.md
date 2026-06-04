# ADR 0002 — Shopify app action proxies to worker, does not call Shopify API directly

## Status
Accepted

## Context
The Shopify embedded app could call the Shopify Admin API directly using the session token, duplicating the parsing and mutation logic from the worker. Alternatively it can proxy to the existing worker (identical to the `frontend-pages/` Pages Function pattern).

## Decision
The React Router `action` in `frontend-shopify-app/` proxies multipart POST requests to the Cloudflare Worker, injecting `X-Api-Key`. No product update logic lives in the app. Worker remains the single source of truth for Excel parsing, row processing, and Shopify mutations.

## Consequences
- Adding a new frontend flavor required zero changes to worker logic.
- All three frontend flavors (headless, Pages, Shopify app) share identical worker behavior.
- If the worker is unreachable, the app action fails — no fallback path.

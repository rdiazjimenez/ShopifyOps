# ADR 0001 — Shopify embedded app hosted on Vercel, not Cloudflare Workers

## Status
Accepted

## Context
`frontend-shopify-app/` requires a Node.js-compatible runtime. `@shopify/shopify-app-remix` (Shopify's auth/session package for React Router apps) is designed for Node.js. Forcing it onto Cloudflare Workers requires a custom adapter and makes session storage (Prisma + Postgres) significantly harder to wire. The rest of ShopifyOps runs on Cloudflare Workers.

## Decision
Host `frontend-shopify-app/` on Vercel (Node.js). Session storage via Prisma + Vercel Postgres (Neon free tier). All other features remain on Cloudflare Workers.

## Consequences
- `frontend-shopify-app/` is the only feature not on Cloudflare.
- Vercel free tier is sufficient for single-merchant usage.
- If Shopify's packages gain stable Cloudflare Workers support, migration is possible but not planned.

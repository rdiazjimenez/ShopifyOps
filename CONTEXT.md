# ShopifyOps — Domain Glossary

ShopifyOps is a collection of operational tools for managing a Shopify store. Each feature is scoped to a specific domain and deployed as a Cloudflare Worker (TypeScript). Workflows are orchestrated via Activepieces.

## Terms

### Store
The single Shopify store managed by ShopifyOps. Credentials (Admin API token, store domain) are stored as Cloudflare Worker secrets.

### Feature
A discrete operational capability within ShopifyOps (e.g. Bulk Update). Each feature is independently deployable and scoped to a specific set of Shopify entities and operations.

### Cloudflare Worker
The runtime for ShopifyOps features. Each feature exposes an HTTP endpoint. TypeScript source compiled and deployed via Cloudflare Workers Builds (GitHub integration). Pushes to `main` auto-deploy. Wrangler used for local development only.

### Activepieces
The automation platform used to trigger ShopifyOps features. Connects external events (file uploads, schedules, user actions) to Cloudflare Worker HTTP endpoints.

## Features

- [`features/bulk-update/`](features/bulk-update/CONTEXT.md) — Bulk update of Shopify Products, Variants, Prices, and Costs from an Excel Workbook.

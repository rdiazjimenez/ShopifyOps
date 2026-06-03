# bulk-update worker

Cloudflare Worker that accepts an Excel workbook upload and applies bulk price/cost updates to Shopify.

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- Cloudflare account with Workers (paid plan recommended for large batches)

## Setup

```bash
npm install
```

### Set secrets

```bash
wrangler secret put SHOPIFY_ACCESS_TOKEN
# paste your Shopify Admin API access token when prompted

wrangler secret put SHOPIFY_STORE_DOMAIN
# paste your store domain, e.g. your-store.myshopify.com
```

## Development

```bash
npm run dev
# worker starts at http://localhost:8787
```

Test the stub endpoint:

```bash
curl -X POST http://localhost:8787/bulk-update
```

## Deploy

```bash
npm run deploy
```

## API

### `POST /bulk-update`

Query params:
- `sheet` (required) — name of the sheet in the uploaded workbook
- `dryRun` (optional, default `false`) — validate without applying changes

Body: `multipart/form-data` with a `file` field containing the Excel workbook.

Response: JSON `ResultReport`

```json
{
  "total": 42,
  "succeeded": 40,
  "failed": 2,
  "errors": [
    { "row": 5, "lookupKey": "SKU-123", "reason": "variant not found" }
  ]
}
```

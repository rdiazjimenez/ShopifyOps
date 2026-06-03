# bulk-update worker

Cloudflare Worker that accepts an Excel workbook upload and applies bulk SKU/price/cost updates to Shopify.

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- Cloudflare account with Workers (paid plan recommended for large batches)

## Setup

```bash
npm install
```

### Generate Shopify Admin API access token

1. Shopify Admin → **Settings** → **Apps and sales channels**
2. Click **Develop apps** (top right)
3. First time only: click **Allow custom app development** → confirm
4. Click **Create an app** — name it e.g. `ShopifyOps Bulk Update`
5. Click **Configure Admin API scopes**, enable:
   - `write_products`
   - `read_products`
   - `read_inventory`
6. Click **Save**
7. Go to **API credentials** tab → click **Install app** → **Install**
8. Click **Reveal token once** — copy immediately, shown only once

Token format: `shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

> Rotate manually if compromised. Scope changes require re-installing the app.

### Set secrets

```bash
wrangler secret put SHOPIFY_ACCESS_TOKEN
# paste your Shopify Admin API access token when prompted

wrangler secret put SHOPIFY_STORE_DOMAIN
# paste hostname only, e.g. your-store.myshopify.com (no https://)

wrangler secret put API_KEY
# paste a strong random secret — this is the shared key Activepieces will send
```

In Activepieces, add an HTTP header to every request to this worker:
```
X-Api-Key: <your API_KEY value>
```

## Development

Copy the example vars file and fill in real values:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` is gitignored. Wrangler injects these as secrets during `npm run dev`.

```bash
npm run dev
# worker starts at http://localhost:8787
```

Test the stub endpoint:

```bash
curl -X POST http://localhost:8787/bulk-update
```

## Deploy

Deployment is automated via Cloudflare Workers Builds connected to the `rdiazjimenez/ShopifyOps` GitHub repository.

- Push to `main` → auto-deploys to production
- Open a PR → preview deployment with unique URL
- Rollback: Cloudflare dashboard → Workers → shopifyops-bulk-update → Deployments

Manual deploy (emergency only):

```bash
npm run deploy
```

### Build configuration (Cloudflare dashboard)

| Setting | Value |
|---|---|
| Root directory | `features/bulk-update/worker` |
| Build command | `npm install` |
| Deploy command | `npx wrangler deploy` |
| Production branch | `main` |
| Build watch path | `features/bulk-update/worker/**` |
| Build cache | Enabled |

Production secrets are set in the Cloudflare dashboard under Variables and secrets (not via `wrangler secret put`).

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

### Workbook columns

Supported Matrixify-style columns:

| Column | Behavior |
|---|---|
| `Command` | `UPDATE` / `MERGE` update existing variants; unsupported commands are skipped |
| `Variant ID` | Primary lookup key; numeric IDs are normalized to Shopify GIDs |
| `Variant SKU` | New SKU when `Variant ID` is present; fallback lookup key when `Variant ID` is blank |
| `Variant Price` | Updates variant `price` |
| `Variant Compare At Price` | Updates variant `compareAtPrice` |
| `Variant Cost` | Updates inventory item cost via `inventoryItem.cost` |

To update only SKU, provide `Command`, `Variant ID`, and the desired `Variant SKU`.

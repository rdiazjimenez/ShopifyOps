# Shopify Admin API Access Token

How to obtain a permanent Admin API access token via OAuth for a custom app.

## Prerequisites

- Shopify Partner account with a development store, or an existing store where you have admin access
- Postman (or any HTTP client) for the token exchange step

## Steps

### 1. Register the App

1. Shopify Admin → profile menu → **Developer Dashboard**
2. Click **Create App**
3. Set name, desired API scopes (e.g. `read_products`, `write_products`), and redirect URL to `http://localhost`

### 2. Get Credentials

1. Go to **Settings** tab of the new app
2. Copy **Client ID** and **Client Secret** — these are the app's username and password

### 3. Install the App

1. From the app's home page in the dashboard, click **Install App**
2. Authorize on your store

### 4. Authorization Flow

Construct this URL and paste into a browser:

```
https://{shop}.myshopify.com/admin/oauth/authorize?client_id={client_id}&redirect_uri={redirect_uri}
```

Replace:
- `{shop}` — your `*.myshopify.com` subdomain
- `{client_id}` — from Step 2
- `{redirect_uri}` — `http://localhost`

After authorizing, the browser redirects to `http://localhost?code=AUTHORIZATION_CODE`. Copy the `code` value from the URL.

### 5. Exchange Code for Token

POST request via Postman (or curl):

```
POST https://{shop}.myshopify.com/admin/oauth/access_token
```

Body (form or JSON):

```json
{
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET",
  "code": "AUTHORIZATION_CODE"
}
```

Successful response:

```json
{
  "access_token": "shpat_xxxxxxxxxxxxxxxxxxxx",
  "scope": "read_products,..."
}
```

This token is permanent. Store it as a Cloudflare Worker secret (`SHOPIFY_ACCESS_TOKEN`).

## Recommended Scopes for ShopifyOps

| Scope | Purpose |
|---|---|
| `read_orders` | Order data |
| `read_all_orders` | Orders older than 60 days |
| `read_analytics` | Analytics data |
| `read_reports` | ShopifyQL queries |
| `read_products` | Product dimensions |
| `write_products` | Bulk update operations |
| `read_metaobject_definitions` | Metafield definitions |
| `read_metaobjects` | Metafield values |

## Notes

- Token is shown **once** via custom app install flow (Settings → Admin API credentials → Reveal). Screenshot or copy immediately.
- OAuth flow above is for Partner Dashboard apps. For custom apps created directly in store admin, skip Steps 4–5 — token is issued directly after install.
- `shopifyqlQuery` requires `read_reports` scope plus Level 2 protected customer data approval. On owner's own store with a custom app, Level 2 requirement is waived.

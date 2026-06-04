Plan
Frontend Shopify App Implementation
Summary
Build frontend-shopify-app/ as a Shopify embedded app using Shopify’s React Router app framework, hosted outside Shopify. Shopify Admin embeds it; Shopify does not run our app code.

Keep existing bulk-update worker unchanged as execution backend.

Refs: Shopify recommends React Router template for most new apps: https://shopify.dev/docs/apps/build/build?framework=reactRouter and https://shopify.dev/docs/api/libraries-and-templates.

Key Changes
Scaffold features/bulk-update/frontend-shopify-app/ from Shopify React Router app template.
Add embedded Admin route for bulk update:
Polaris/App Bridge app shell
Excel upload
client sheet-name preview from .xlsx
sheet selector
dry-run toggle
submit/progress/error states
result summary + per-row table
annotated workbook download
Add React Router action endpoint:
accepts multipart upload from app UI
uses Shopify app authentication/session validation
confirms current shop matches configured single store
proxies request to existing worker with server-only X-Api-Key
Keep worker API unchanged:
POST /bulk-update?sheet=&dryRun=
X-Api-Key
multipart file
Do not move product update logic into app yet. Worker remains source of truth for parsing, row rules, Shopify mutations, and Result Report.
Hosting/Auth
App is embedded in Shopify Admin, but hosted externally.
Use Shopify React Router auth/session handling instead of hand-rolled JWT verification where possible.
Deploy externally; preferred runtime remains Cloudflare if compatible with the scaffold. If Shopify template requires Node server for least friction, use Node-compatible hosting for this app only.
Required app scopes: read_products, write_products, read_inventory, write_inventory.
Test Plan
UI: file upload populates sheets; submit disabled until valid file/sheet; dry-run query set correctly.
Action/proxy: unauthenticated request rejected; wrong shop rejected; valid request injects X-Api-Key; worker response returned unchanged.
Result UI: counts/table render from Result Report.
Download: annotated workbook appends Status, Reason, and Results.
Worker regression: existing worker tests stay green.
Assumptions
Single Shopify store.
Existing worker remains deployed and private behind API_KEY.
No productSet migration now; current worker already implements required product/variant/cost logic.
No direct hosting “inside Shopify”; embedded app means Shopify iframe + external app backend.

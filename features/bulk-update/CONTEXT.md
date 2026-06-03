# Bulk Update — Domain Glossary

## Terms

### Product
A Shopify product entity. Has one or more Variants. Managed via Shopify Admin GraphQL API.

### Variant
A specific purchasable version of a Product (e.g. size/color combination). Carries its own price and inventory.

### Price
The monetary value assigned to a Variant. Stored as a decimal string in Shopify (e.g. "19.99"). Includes `price` and `compareAtPrice`.

### Cost
The cost of goods for a Variant. Stored on `InventoryItem.unitCost`. Updated via `inventoryItemUpdate` mutation, separate from price updates.

### Bulk Operation
A user-initiated action that updates up to hundreds of Variant records in a single execution. Driven by data from an Excel Workbook. Scope: update-only (no create or delete). Rows are processed independently — a failed row is skipped and logged; remaining rows continue. Returns a Result Report.

### Result Report
The response from a Bulk Operation. Contains: total rows processed, success count, list of failed rows with row number and error reason.

### Dry Run
Optional mode (`?dryRun=true`) where rows are validated and API calls are simulated but no mutations are sent to Shopify. Returns a Result Report showing what would have changed.

### Excel Workbook
The source of truth for bulk operation data. Follows Matrixify column format. Each row represents one Variant record. Empty cell = skip that field. Key columns: `Handle`, `Variant ID`, `Variant SKU`, `Command`, `Variant Price`, `Variant Compare At Price`, `Variant Cost`.

### Command
Per-row instruction column (Matrixify format). Supported values: `UPDATE` (update only, fail if not found), `MERGE` (update or create). Other values (`NEW`, `DELETE`, `REPLACE`, `IGNORE`) out of scope for initial release.

### Lookup Key
The identifier used to match an Excel row to a Shopify Variant. Variant ID takes precedence; SKU is used as fallback when Variant ID is absent.

### Store Credentials
Single Shopify store. Admin API token stored as Cloudflare Worker secret (`SHOPIFY_ACCESS_TOKEN`). Store domain stored as `SHOPIFY_STORE_DOMAIN`.

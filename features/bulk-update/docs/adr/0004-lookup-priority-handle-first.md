# ADR 0004 — Lookup priority: Handle-first over specificity-first

## Status
Accepted — extends ADR 0003

## Context
The original lookup chain followed a **specificity-first** principle:

```
Variant ID → Variant SKU → Product ID → Handle → fail
```

The rationale was that the most specific identifier (Variant ID) should win to minimise ambiguity.

In practice, every Shopify bulk export produced by Matrixify includes a `Handle` column as the primary product identifier. Variant ID and Variant SKU appear alongside Handle on every exported row. Under the old chain, a row containing `Handle + Variant SKU` would incorrectly treat `Variant SKU` as a lookup key (because Variant ID was absent) instead of a field to set — triggering a spurious "SKU not found" failure when the user's intent was to update the SKU value.

The root causes were two coupled bugs:
1. The parser read the `Variant SKU` column before `Handle` and `ID`, so the `newSku` vs `sku` decision could not see whether a product anchor was present.
2. The `newSku` promotion condition only checked for `Variant ID` presence, missing the `Handle` and `Product ID` cases.

## Decision
Switch to a **Matrixify-format-first** priority chain:

```
Handle → Product ID → Variant ID → Variant SKU → fail
```

Key rules:
- `Variant SKU` is a lookup key **only** when Handle, Product ID, and Variant ID are all absent.
- When Handle or Product ID is the anchor and `Variant ID` is also present, `Variant ID` is used directly to target the specific variant — no `resolveProductToSingleVariantId` call is needed. This enables multi-variant products to be targeted via the natural Matrixify export format.
- The parser reads `Handle` and `ID` columns before `Variant SKU` so the `newSku` vs `sku` decision can see all anchors.

## Consequences

### Positive
- Matrixify exports can be used as-is: a sheet with `Handle + Variant SKU` columns will correctly update the SKU value without any column manipulation.
- Multi-variant products can be targeted by exporting `Handle + Variant ID` — the natural Matrixify format.
- The lookup chain mirrors how merchants think about products: start with the product (Handle), then narrow to the variant.

### Negative / Trade-offs
- **Breaking change for SKU-as-lookup sheets**: any existing Excel sheet that relies on `Variant SKU` as a lookup key while also including a `Handle` or `Product ID` column will have its behaviour change. `Variant SKU` will be treated as a field to set, and the row will fail unless Handle or Product ID successfully identifies the product. Affected users must remove the `Handle` / `ID` column from their sheet, or switch to using `Variant ID` alongside `Handle` for explicit variant targeting.
- A standalone `Variant ID` row (no Handle, no Product ID) is still supported via `resolveVariantToProductId`, but it is now the third priority rather than the first.

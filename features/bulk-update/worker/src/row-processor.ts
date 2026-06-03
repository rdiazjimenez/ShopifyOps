import type { ParsedRow } from "./excel-parser";
import type { ShopifyClient, VariantInput } from "./shopify-client";
import { ShopifyClientError } from "./shopify-client";

export type ProcessedRow =
  | { type: "pending"; row: number; lookupKey: string; productId: string; variantInput: VariantInput }
  | { type: "failed"; row: number; lookupKey: string; reason: string }
  | { type: "skipped"; row: number; lookupKey: string; reason: string };

export async function processRow(row: ParsedRow, client: ShopifyClient): Promise<ProcessedRow> {
  if (row.skipped) {
    return { type: "skipped", row: row.row, lookupKey: "", reason: row.reason };
  }

  const { row: rowNum, command, variantId, sku, price, compareAtPrice, cost } = row;

  if (!price && !compareAtPrice && !cost) {
    return { type: "skipped", row: rowNum, lookupKey: variantId ?? sku ?? "", reason: "no fields to update" };
  }

  let resolvedVariantId: string;
  let resolvedProductId: string;
  const lookupKey = variantId ?? sku ?? "";

  if (variantId) {
    resolvedVariantId = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
    try {
      resolvedProductId = await client.resolveVariantToProductId(resolvedVariantId);
    } catch (err) {
      const reason = err instanceof ShopifyClientError ? err.message : "Variant lookup failed";
      return { type: "failed", row: rowNum, lookupKey, reason };
    }
  } else if (sku) {
    try {
      const ids = await client.resolveSkuToIds(sku);
      resolvedVariantId = ids.variantId;
      resolvedProductId = ids.productId;
    } catch (err) {
      const reason = err instanceof ShopifyClientError ? err.message : "SKU lookup failed";
      return { type: "failed", row: rowNum, lookupKey, reason };
    }
  } else {
    return { type: "failed", row: rowNum, lookupKey: "", reason: "no lookup key" };
  }

  const variantInput: VariantInput = { id: resolvedVariantId };
  if (price !== undefined) variantInput.price = price;
  if (compareAtPrice !== undefined) variantInput.compareAtPrice = compareAtPrice;
  if (cost !== undefined) variantInput.cost = cost;

  return { type: "pending", row: rowNum, lookupKey, productId: resolvedProductId, variantInput };
}

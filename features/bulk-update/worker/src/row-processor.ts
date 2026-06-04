import type { ParsedRow } from "./excel-parser";
import type { ShopifyClient, VariantInput, ProductInput } from "./shopify-client";
import { ShopifyClientError } from "./shopify-client";

export interface ProductFields {
  title?: string;
  bodyHtml?: string;
  vendor?: string;
  productType?: string;
  status?: string;
}

export type ProcessedRow =
  | { type: "pending"; row: number; lookupKey: string; productId: string; variantInput: VariantInput; productFields?: ProductFields }
  | { type: "failed"; row: number; lookupKey: string; reason: string }
  | { type: "skipped"; row: number; lookupKey: string; reason: string };

export async function processRow(row: ParsedRow, client: ShopifyClient): Promise<ProcessedRow> {
  if (row.skipped) {
    return { type: "skipped", row: row.row, lookupKey: "", reason: row.reason };
  }

  const { row: rowNum, command, variantId, sku, newSku, price, compareAtPrice, cost, title, bodyHtml, vendor, productType, status } = row;

  // A row is valid if it has at least one variant field OR at least one product field.
  // The First-Row Rule (only first row of each product carries product fields) is enforced by the Batch Orchestrator.
  const hasVariantFields = !!(newSku || price || compareAtPrice || cost);
  const hasProductFields = !!(title || bodyHtml || vendor || productType || status);

  if (!hasVariantFields && !hasProductFields) {
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
  if (newSku !== undefined) variantInput.sku = newSku;
  if (price !== undefined) variantInput.price = price;
  if (compareAtPrice !== undefined) variantInput.compareAtPrice = compareAtPrice;
  if (cost !== undefined) variantInput.cost = cost;

  const productFieldsObj: ProductFields = {};
  if (title !== undefined) productFieldsObj.title = title;
  if (bodyHtml !== undefined) productFieldsObj.bodyHtml = bodyHtml;
  if (vendor !== undefined) productFieldsObj.vendor = vendor;
  if (productType !== undefined) productFieldsObj.productType = productType;
  if (status !== undefined) productFieldsObj.status = status;

  const pending: ProcessedRow & { type: "pending" } = {
    type: "pending",
    row: rowNum,
    lookupKey,
    productId: resolvedProductId,
    variantInput,
  };

  if (hasProductFields) {
    pending.productFields = productFieldsObj;
  }

  return pending;
}

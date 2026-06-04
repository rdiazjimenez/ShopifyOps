import type { ParsedRow } from "./excel-parser";
import type { ShopifyClient, VariantInput, ProductInput } from "./shopify-client";
import { ShopifyClientError } from "./shopify-client";

export interface ProductFields {
  title?: string;
  bodyHtml?: string;
  vendor?: string;
  productType?: string;
  status?: string;
  tags?: string;
  tagsCommand?: string;
}

export type ProcessedRow =
  | { type: "pending"; row: number; lookupKey: string; productId: string; variantInput: VariantInput; productFields?: ProductFields; productPath?: true; createVariant?: true }
  | { type: "failed"; row: number; lookupKey: string; reason: string }
  | { type: "skipped"; row: number; lookupKey: string; reason: string };

export async function processRow(row: ParsedRow, client: ShopifyClient): Promise<ProcessedRow> {
  if (row.skipped) {
    return { type: "skipped", row: row.row, lookupKey: "", reason: row.reason };
  }

  const { row: rowNum, command, variantId, sku, productId: rawProductId, newSku, price, compareAtPrice, cost, title, bodyHtml, vendor, productType, status, tags, tagsCommand } = row;

  // A row is valid if it has at least one variant field OR at least one product field.
  // The First-Row Rule (only first row of each product carries product fields) is enforced by the Batch Orchestrator.
  const hasVariantFields = !!(newSku || price || compareAtPrice || cost);
  const hasProductFields = !!(title || bodyHtml || vendor || productType || status || tags);

  if (!hasVariantFields && !hasProductFields) {
    return { type: "skipped", row: rowNum, lookupKey: variantId ?? sku ?? rawProductId ?? row.handle ?? "", reason: "no fields to update" };
  }

  let resolvedVariantId: string;
  let resolvedProductId: string;
  let lookupKey = variantId ?? sku ?? rawProductId ?? "";  // updated inline for handle path

  if (command !== "NEW" && variantId) {
    resolvedVariantId = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
    try {
      resolvedProductId = await client.resolveVariantToProductId(resolvedVariantId);
    } catch (err) {
      const reason = err instanceof ShopifyClientError ? err.message : "Variant lookup failed";
      return { type: "failed", row: rowNum, lookupKey, reason };
    }
  } else if (command !== "NEW" && sku) {
    try {
      const ids = await client.resolveSkuToIds(sku);
      resolvedVariantId = ids.variantId;
      resolvedProductId = ids.productId;
    } catch (err) {
      const reason = err instanceof ShopifyClientError ? err.message : "SKU lookup failed";
      return { type: "failed", row: rowNum, lookupKey, reason };
    }
  } else if (rawProductId) {
    // Normalize Product ID to GID (no API call required)
    let normalizedProductId: string;
    if (rawProductId.startsWith("gid://")) {
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(rawProductId)) {
        return { type: "failed", row: rowNum, lookupKey: rawProductId, reason: `Invalid Product GID: "${rawProductId}"` };
      }
      normalizedProductId = rawProductId;
    } else {
      normalizedProductId = `gid://shopify/Product/${rawProductId}`;
    }

    const productFieldsObj: ProductFields = {};
    if (title !== undefined) productFieldsObj.title = title;
    if (bodyHtml !== undefined) productFieldsObj.bodyHtml = bodyHtml;
    if (vendor !== undefined) productFieldsObj.vendor = vendor;
    if (productType !== undefined) productFieldsObj.productType = productType;
    if (status !== undefined) productFieldsObj.status = status;
    if (tags !== undefined) productFieldsObj.tags = tags;
    if (tagsCommand !== undefined) productFieldsObj.tagsCommand = tagsCommand;

    if (command === "NEW" && hasVariantFields) {
      const variantInput: VariantInput = { id: normalizedProductId }; // sentinel — not used as variant GID
      if (newSku !== undefined) variantInput.sku = newSku;
      if (price !== undefined) variantInput.price = price;
      if (compareAtPrice !== undefined) variantInput.compareAtPrice = compareAtPrice;
      if (cost !== undefined) variantInput.cost = cost;
      const createPending: ProcessedRow & { type: "pending" } = {
        type: "pending",
        row: rowNum,
        lookupKey: rawProductId,
        productId: normalizedProductId,
        variantInput,
        createVariant: true,
      };
      if (hasProductFields) createPending.productFields = productFieldsObj;
      return createPending;
    }

    if (hasVariantFields) {
      // Auto-resolve: product has exactly one variant — resolve and fall through to variant update.
      try {
        resolvedVariantId = await client.resolveProductToSingleVariantId(normalizedProductId);
        resolvedProductId = normalizedProductId;
      } catch (err) {
        const reason = err instanceof ShopifyClientError ? err.message : "Variant lookup failed";
        return { type: "failed", row: rowNum, lookupKey: rawProductId, reason };
      }
    } else {
      // Product-path: no variant fields — update product fields only.
      const productPathPending: ProcessedRow & { type: "pending" } = {
        type: "pending",
        row: rowNum,
        lookupKey: rawProductId,
        productId: normalizedProductId,
        variantInput: { id: normalizedProductId }, // sentinel
        productPath: true,
      };
      if (hasProductFields) productPathPending.productFields = productFieldsObj;
      return productPathPending;
    }
  } else if (row.handle) {
    const handle = row.handle;
    lookupKey = handle; // update for fall-through to variant building
    let resolvedHandleProductId: string;
    try {
      resolvedHandleProductId = await client.resolveHandleToProductId(handle);
    } catch (err) {
      const reason = err instanceof ShopifyClientError ? err.message : "Handle lookup failed";
      return { type: "failed", row: rowNum, lookupKey: handle, reason };
    }

    const productFieldsObj: ProductFields = {};
    if (title !== undefined) productFieldsObj.title = title;
    if (bodyHtml !== undefined) productFieldsObj.bodyHtml = bodyHtml;
    if (vendor !== undefined) productFieldsObj.vendor = vendor;
    if (productType !== undefined) productFieldsObj.productType = productType;
    if (status !== undefined) productFieldsObj.status = status;
    if (tags !== undefined) productFieldsObj.tags = tags;
    if (tagsCommand !== undefined) productFieldsObj.tagsCommand = tagsCommand;

    if (command === "NEW" && hasVariantFields) {
      const variantInput: VariantInput = { id: resolvedHandleProductId }; // sentinel — not used as variant GID
      if (newSku !== undefined) variantInput.sku = newSku;
      if (price !== undefined) variantInput.price = price;
      if (compareAtPrice !== undefined) variantInput.compareAtPrice = compareAtPrice;
      if (cost !== undefined) variantInput.cost = cost;
      const createPending: ProcessedRow & { type: "pending" } = {
        type: "pending",
        row: rowNum,
        lookupKey: handle,
        productId: resolvedHandleProductId,
        variantInput,
        createVariant: true,
      };
      if (hasProductFields) createPending.productFields = productFieldsObj;
      return createPending;
    }

    if (hasVariantFields) {
      // Auto-resolve: product has exactly one variant — resolve and fall through to variant update.
      try {
        resolvedVariantId = await client.resolveProductToSingleVariantId(resolvedHandleProductId);
        resolvedProductId = resolvedHandleProductId;
      } catch (err) {
        const reason = err instanceof ShopifyClientError ? err.message : "Variant lookup failed";
        return { type: "failed", row: rowNum, lookupKey: handle, reason };
      }
    } else {
      // Product-path: no variant fields — update product fields only.
      const handlePathPending: ProcessedRow & { type: "pending" } = {
        type: "pending",
        row: rowNum,
        lookupKey: handle,
        productId: resolvedHandleProductId,
        variantInput: { id: resolvedHandleProductId }, // sentinel
        productPath: true,
      };
      if (hasProductFields) handlePathPending.productFields = productFieldsObj;
      return handlePathPending;
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
  if (tags !== undefined) productFieldsObj.tags = tags;
  if (tagsCommand !== undefined) productFieldsObj.tagsCommand = tagsCommand;

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

import { describe, it, expect, vi } from "vitest";
import { processRow } from "./row-processor";
import type { ShopifyClient } from "./shopify-client";
import { ShopifyClientError } from "./shopify-client";

const VARIANT_GID = "gid://shopify/ProductVariant/222";
const PRODUCT_GID = "gid://shopify/Product/111";

function makeClient(overrides: Partial<ShopifyClient> = {}): ShopifyClient {
  return {
    updateVariants: vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] }),
    resolveSkuToIds: vi.fn().mockResolvedValue({ variantId: VARIANT_GID, productId: PRODUCT_GID }),
    resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_GID),
    ...overrides,
  } as unknown as ShopifyClient;
}

const baseRow = { skipped: false as const, row: 1, command: "UPDATE" as const };

describe("processRow — lookup key resolution", () => {
  it("uses Variant ID directly, resolves productId via resolveVariantToProductId", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, price: "9.99" }, client);
    expect(client.resolveVariantToProductId).toHaveBeenCalledWith(VARIANT_GID);
    expect(client.resolveSkuToIds).not.toHaveBeenCalled();
    expect(result.type).toBe("pending");
  });

  it("falls back to SKU when Variant ID absent", async () => {
    const client = makeClient();
    await processRow({ ...baseRow, sku: "SKU-001", price: "9.99" }, client);
    expect(client.resolveSkuToIds).toHaveBeenCalledWith("SKU-001");
    expect(client.resolveVariantToProductId).not.toHaveBeenCalled();
  });

  it("Variant ID takes precedence over SKU when both present", async () => {
    const client = makeClient();
    await processRow({ ...baseRow, variantId: VARIANT_GID, sku: "SKU-001", price: "9.99" }, client);
    expect(client.resolveVariantToProductId).toHaveBeenCalled();
    expect(client.resolveSkuToIds).not.toHaveBeenCalled();
  });

  it("returns failed with 'no lookup key' when neither ID nor SKU", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("no lookup key");
  });
});

describe("processRow — no-op row", () => {
  it("returns skipped with 'no fields to update' when no price/compareAtPrice/cost", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID }, client);
    expect(result.type).toBe("skipped");
    if (result.type === "skipped") expect(result.reason).toBe("no fields to update");
    expect(client.updateVariants).not.toHaveBeenCalled();
  });

  it("does not skip when only newSku is present", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, newSku: "NEW-SKU" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") expect(result.variantInput.sku).toBe("NEW-SKU");
  });
});

describe("processRow — field dispatch", () => {
  it("passes only present fields in variantInput", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.price).toBe("9.99");
      expect("compareAtPrice" in result.variantInput).toBe(false);
      expect("cost" in result.variantInput).toBe(false);
    }
  });

  it("passes all three fields when all present", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, price: "9.99", compareAtPrice: "14.99", cost: "5.00" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.price).toBe("9.99");
      expect(result.variantInput.compareAtPrice).toBe("14.99");
      expect(result.variantInput.cost).toBe("5.00");
    }
  });

  it("passes newSku as sku in variantInput", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, newSku: "NEW-SKU", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.sku).toBe("NEW-SKU");
      expect(result.variantInput.price).toBe("9.99");
    }
  });

  it("includes productId in pending result", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") expect(result.productId).toBe(PRODUCT_GID);
  });
});

describe("processRow — failure cases", () => {
  it("returns failed when Variant not found", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockRejectedValue(new ShopifyClientError("Variant not found")),
    });
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("Variant not found");
  });

  it("UPDATE: returns failed when SKU not found", async () => {
    const client = makeClient({
      resolveSkuToIds: vi.fn().mockRejectedValue(new ShopifyClientError("SKU not found")),
    });
    const result = await processRow({ ...baseRow, command: "UPDATE", sku: "MISSING", price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("SKU not found");
  });

  it("MERGE: returns failed when variant not found (no create)", async () => {
    const client = makeClient({
      resolveSkuToIds: vi.fn().mockRejectedValue(new ShopifyClientError("SKU not found")),
    });
    const result = await processRow({ ...baseRow, command: "MERGE", sku: "MISSING", price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("SKU not found");
  });

  it("returns failed on SKU ambiguity", async () => {
    const client = makeClient({
      resolveSkuToIds: vi.fn().mockRejectedValue(new ShopifyClientError("SKU matches multiple variants")),
    });
    const result = await processRow({ ...baseRow, sku: "DUPE", price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("SKU matches multiple variants");
  });

  it("returns skipped when input row is already skipped", async () => {
    const client = makeClient();
    const result = await processRow({ skipped: true, row: 1, reason: "unsupported command: DELETE" }, client);
    expect(result.type).toBe("skipped");
  });
});

describe("processRow — product fields", () => {
  it("row with only product fields is not skipped", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, title: "New Title" }, client);
    expect(result.type).toBe("pending");
  });

  it("row with only variant fields continues to work", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect("productFields" in result).toBe(false);
    }
  });

  it("row with both product and variant fields is pending with both", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, price: "9.99", title: "New Title" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.price).toBe("9.99");
      expect(result.productFields?.title).toBe("New Title");
    }
  });

  it("row with neither product nor variant fields is skipped", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID }, client);
    expect(result.type).toBe("skipped");
  });

  it("product fields are carried in productFields of pending result", async () => {
    const client = makeClient();
    const result = await processRow({
      ...baseRow,
      variantId: VARIANT_GID,
      title: "T",
      bodyHtml: "<p>D</p>",
      vendor: "V",
      productType: "PT",
    }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productFields?.title).toBe("T");
      expect(result.productFields?.bodyHtml).toBe("<p>D</p>");
      expect(result.productFields?.vendor).toBe("V");
      expect(result.productFields?.productType).toBe("PT");
    }
  });
});

describe("processRow — product-path (Product ID, Issue #32)", () => {
  it("row with Product ID only (no Variant ID, no SKU) + product fields → pending with productPath", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", title: "New Title" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productPath).toBe(true);
      expect(result.productId).toBe("gid://shopify/Product/111");
      expect(result.productFields?.title).toBe("New Title");
    }
  });

  it("normalizes numeric Product ID to GID", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "12345", title: "T" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe("gid://shopify/Product/12345");
    }
  });

  it("passes through full GID Product ID unchanged", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "gid://shopify/Product/999", title: "T" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe("gid://shopify/Product/999");
    }
  });

  it("wrong-entity GID (ProductVariant) → failed with 'Invalid Product GID'", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "gid://shopify/ProductVariant/111", title: "T" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.reason).toContain("Invalid Product GID");
    }
  });

  it("Product ID with variant fields (price) → failed with 'variant lookup key required for variant fields'", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.reason).toBe("variant lookup key required for variant fields");
      expect(result.lookupKey).toBe("111");
    }
  });

  it("Product ID with SKU variant field → failed", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", newSku: "NEW-SKU" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.reason).toBe("variant lookup key required for variant fields");
    }
  });

  it("Product ID with cost variant field → failed", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", cost: "3.00" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.reason).toBe("variant lookup key required for variant fields");
    }
  });

  it("Product ID with no product or variant fields → skipped 'no fields to update'", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111" }, client);
    expect(result.type).toBe("skipped");
    if (result.type === "skipped") expect(result.reason).toBe("no fields to update");
  });

  it("Variant ID present → Variant ID wins over Product ID; resolveVariantToProductId called", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, productId: "111", price: "9.99" }, client);
    expect(client.resolveVariantToProductId).toHaveBeenCalled();
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productPath).toBeUndefined();
    }
  });

  it("SKU present (no Variant ID) → SKU wins over Product ID; resolveSkuToIds called", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, sku: "SKU-001", productId: "111", price: "9.99" }, client);
    expect(client.resolveSkuToIds).toHaveBeenCalledWith("SKU-001");
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productPath).toBeUndefined();
    }
  });

  it("lookupKey equals Product ID value used in the row", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", title: "T" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.lookupKey).toBe("111");
    }
  });

  it("product-path row has no API calls (no resolveVariantToProductId, no resolveSkuToIds)", async () => {
    const client = makeClient();
    await processRow({ ...baseRow, productId: "111", title: "T" }, client);
    expect(client.resolveVariantToProductId).not.toHaveBeenCalled();
    expect(client.resolveSkuToIds).not.toHaveBeenCalled();
  });
});

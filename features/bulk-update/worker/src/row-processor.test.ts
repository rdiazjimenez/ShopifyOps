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

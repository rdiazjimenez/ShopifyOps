import { describe, it, expect, vi } from "vitest";
import { processRow } from "./row-processor";
import type { BulkUpdateShopifyClient } from "./shopify-client";
import { ShopifyClientError } from "./shopify-client";

const VARIANT_GID = "gid://shopify/ProductVariant/222";
const PRODUCT_GID = "gid://shopify/Product/111";

function makeClient(overrides: Partial<BulkUpdateShopifyClient> = {}): BulkUpdateShopifyClient {
  return {
    updateVariants: vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] }),
    resolveSkuToIds: vi.fn().mockResolvedValue({ variantId: VARIANT_GID, productId: PRODUCT_GID }),
    resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_GID),
    resolveHandleToProductId: vi.fn().mockResolvedValue(PRODUCT_GID),
    resolveProductToSingleVariantId: vi.fn().mockResolvedValue(VARIANT_GID),
    updateProduct: vi.fn().mockResolvedValue({ product: { id: PRODUCT_GID }, userErrors: [] }),
    fetchProductTags: vi.fn().mockResolvedValue([]),
    createVariants: vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] }),
    ...overrides,
  } as unknown as BulkUpdateShopifyClient;
}

const baseRow = { skipped: false as const, row: 1, command: "UPDATE" as const };

describe("processRow — lookup key resolution", () => {
  it("Variant ID row resolves to pending with correct productId and variantInput", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe(PRODUCT_GID);
      expect(result.variantInput.id).toBe(VARIANT_GID);
    }
  });

  it("SKU row (no Variant ID) resolves to pending with correct productId", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, sku: "SKU-001", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe(PRODUCT_GID);
      expect(result.lookupKey).toBe("SKU-001");
    }
  });

  it("Variant ID takes precedence over SKU when both present", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, sku: "SKU-001", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.id).toBe(VARIANT_GID);
      expect(result.productPath).toBeUndefined();
    }
  });

  it("returns failed with 'no lookup key' when neither ID nor SKU", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("no lookup key");
  });

  it("empty-string Handle treated as no lookup key — fails with 'no lookup key'", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, handle: "", price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("no lookup key");
  });

  it("whitespace-only Handle treated as no lookup key — fails with 'no lookup key'", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, handle: "   ", price: "9.99" }, client);
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

  it("Product ID + variant field (price) + single-variant product → auto-resolves to pending", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.id).toBe(VARIANT_GID);
      expect(result.variantInput.price).toBe("9.99");
      expect(result.lookupKey).toBe("111");
    }
  });

  it("Product ID + SKU variant field + single-variant product → auto-resolves to pending", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", newSku: "NEW-SKU" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.sku).toBe("NEW-SKU");
    }
  });

  it("Product ID + variant field + multi-variant product → failed with 'Product has multiple variants'", async () => {
    const client = makeClient({
      resolveProductToSingleVariantId: vi.fn().mockRejectedValue(
        new ShopifyClientError("Product has multiple variants — Variant ID required")
      ),
    });
    const result = await processRow({ ...baseRow, productId: "111", cost: "3.00" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.reason).toBe("Product has multiple variants — Variant ID required");
    }
  });

  it("Product ID with no product or variant fields → skipped 'no fields to update'", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111" }, client);
    expect(result.type).toBe("skipped");
    if (result.type === "skipped") expect(result.reason).toBe("no fields to update");
  });

  it("Variant ID present → Variant ID wins over Product ID", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, productId: "111", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.id).toBe(VARIANT_GID);
      expect(result.productPath).toBeUndefined();
    }
  });

  it("Product ID present (no Handle) → Product ID wins over SKU", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, sku: "SKU-001", productId: "111", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      // Product ID takes priority over SKU in the Handle -> Product ID -> Variant ID -> SKU chain.
      expect(result.lookupKey).toBe("111");
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

  it("product-path row returns productPath:true with correct productId (no variant resolution needed)", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", title: "T" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productPath).toBe(true);
      expect(result.productId).toBe("gid://shopify/Product/111");
    }
  });
});


describe("processRow - handle product-path (Issue #33)", () => {
  it("row with Handle only (no Variant ID, no SKU, no Product ID) + product fields - pending with productPath", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, handle: "my-product", title: "New Title" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productPath).toBe(true);
      expect(result.productId).toBe(PRODUCT_GID);
      expect(result.productFields?.title).toBe("New Title");
    }
  });

  it("handle-path row resolves to correct productId", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, handle: "my-product", title: "T" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe(PRODUCT_GID);
      expect(result.productPath).toBe(true);
    }
  });

  it("Handle not found - failed with reason Handle not found", async () => {
    const client = makeClient({
      resolveHandleToProductId: vi.fn().mockRejectedValue(new ShopifyClientError("Handle not found")),
    });
    const result = await processRow({ ...baseRow, handle: "missing-handle", title: "T" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.reason).toBe("Handle not found");
      expect(result.lookupKey).toBe("missing-handle");
    }
  });

  it("Handle + variant field (price) + single-variant product → auto-resolves to pending", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, handle: "my-product", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.id).toBe(VARIANT_GID);
      expect(result.variantInput.price).toBe("9.99");
      expect(result.lookupKey).toBe("my-product");
    }
  });

  it("Handle + variant field + multi-variant product → failed with 'Product has multiple variants'", async () => {
    const client = makeClient({
      resolveProductToSingleVariantId: vi.fn().mockRejectedValue(
        new ShopifyClientError("Product has multiple variants — Variant ID required")
      ),
    });
    const result = await processRow({ ...baseRow, handle: "my-product", cost: "3.00" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.reason).toBe("Product has multiple variants — Variant ID required");
      expect(result.lookupKey).toBe("my-product");
    }
  });

  it("Variant ID + Handle - Variant ID wins", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, variantId: VARIANT_GID, handle: "my-product", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.variantInput.id).toBe(VARIANT_GID);
      expect(result.productPath).toBeUndefined();
    }
  });

  it("Handle present → Handle wins over SKU", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, sku: "SKU-001", handle: "my-product", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      // Handle takes priority over SKU in the Handle -> Product ID -> Variant ID -> SKU chain.
      expect(result.lookupKey).toBe("my-product");
      expect(result.productPath).toBeUndefined();
    }
  });

  it("Handle + Product ID - Handle wins (resolves product via handle)", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", handle: "my-product", title: "T" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      // Handle takes priority over Product ID in the Handle -> Product ID -> Variant ID -> SKU chain.
      // Mock resolveHandleToProductId returns PRODUCT_GID, so productId still resolves to PRODUCT_GID.
      expect(result.productId).toBe("gid://shopify/Product/111");
      expect(result.lookupKey).toBe("my-product");
    }
  });

  it("lookupKey equals the Handle string used in the row", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, handle: "cool-product", title: "T" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.lookupKey).toBe("cool-product");
    }
  });

  it("handle-path row returns pending (lookup runs even in dry-run context)", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, handle: "my-product", title: "T" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productPath).toBe(true);
      expect(result.productId).toBe(PRODUCT_GID);
    }
  });
});

describe("processRow - NEW command", () => {
  it("NEW with Product ID creates a variant pending row and does not mark productPath", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, command: "NEW", productId: "111", newSku: "NEW-SKU", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe("gid://shopify/Product/111");
      expect(result.createVariant).toBe(true);
      expect(result.productPath).toBeUndefined();
      expect(result.variantInput.sku).toBe("NEW-SKU");
      expect(result.variantInput.price).toBe("9.99");
    }
  });

  it("NEW with Handle creates a variant pending row and does not mark productPath", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, command: "NEW", handle: "my-product", newSku: "NEW-SKU" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe(PRODUCT_GID);
      expect(result.createVariant).toBe(true);
      expect(result.productPath).toBeUndefined();
      expect(result.variantInput.sku).toBe("NEW-SKU");
    }
  });

  it("NEW with Variant SKU but no Product ID or Handle fails with no lookup key", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, command: "NEW", newSku: "NEW-SKU" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("no lookup key");
  });

  it("NEW with legacy sku but no Product ID or Handle does not use SKU as lookup", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, command: "NEW", sku: "SKU-001", price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("no lookup key");
  });

  it("NEW with Variant ID but no Product ID or Handle does not update existing variant", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, command: "NEW", variantId: VARIANT_GID, price: "9.99" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.reason).toBe("no lookup key");
  });

  it("NEW with Product ID but no variant fields fails with 'NEW command requires at least one variant field'", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, command: "NEW", productId: "111", title: "New Product Title" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.reason).toBe("NEW command requires at least one variant field");
      expect(result.lookupKey).toBe("111");
    }
  });

  it("NEW with Handle but no variant fields fails with 'NEW command requires at least one variant field'", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, command: "NEW", handle: "my-product", title: "New Product Title" }, client);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.reason).toBe("NEW command requires at least one variant field");
      expect(result.lookupKey).toBe("my-product");
    }
  });
});

describe("processRow - combined lookup: Handle/ProductID + VariantID + newSku (Issue #68)", () => {
  it("Handle + newSku (single variant) succeeds: handle resolves product, single variant auto-resolved, SKU updated", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, handle: "my-product", newSku: "UPDATED-SKU" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe(PRODUCT_GID);
      expect(result.variantInput.id).toBe(VARIANT_GID);
      expect(result.variantInput.sku).toBe("UPDATED-SKU");
      expect(result.productPath).toBeUndefined();
    }
  });

  it("Handle + Variant ID + newSku (multi-variant): handle resolves product, Variant ID picks variant directly", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, handle: "my-product", variantId: VARIANT_GID, newSku: "UPDATED-SKU" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe(PRODUCT_GID);
      // Variant ID used directly -- resolveProductToSingleVariantId NOT called
      expect(client.resolveProductToSingleVariantId).not.toHaveBeenCalled();
      expect(result.variantInput.id).toBe(VARIANT_GID);
      expect(result.variantInput.sku).toBe("UPDATED-SKU");
    }
  });

  it("Product ID + Variant ID + newSku: product ID resolves, Variant ID picks variant directly", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, productId: "111", variantId: VARIANT_GID, newSku: "UPDATED-SKU" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.productId).toBe("gid://shopify/Product/111");
      // Variant ID used directly -- resolveProductToSingleVariantId NOT called
      expect(client.resolveProductToSingleVariantId).not.toHaveBeenCalled();
      expect(result.variantInput.id).toBe(VARIANT_GID);
      expect(result.variantInput.sku).toBe("UPDATED-SKU");
    }
  });

  it("Variant SKU alone (no handle, no product ID, no variant ID) still used as lookup key", async () => {
    const client = makeClient();
    const result = await processRow({ ...baseRow, sku: "LOOKUP-SKU", price: "9.99" }, client);
    expect(result.type).toBe("pending");
    if (result.type === "pending") {
      expect(result.lookupKey).toBe("LOOKUP-SKU");
      expect(client.resolveSkuToIds).toHaveBeenCalledWith("LOOKUP-SKU");
    }
  });
});

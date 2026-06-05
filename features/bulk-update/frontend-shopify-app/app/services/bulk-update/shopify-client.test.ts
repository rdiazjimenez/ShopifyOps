import { describe, it, expect, vi } from "vitest";
import { InstalledShopifyClient, ShopifyClientError } from "./shopify-client";

const PRODUCT_GID = "gid://shopify/Product/111";
const VARIANT_GID = "gid://shopify/ProductVariant/222";

function makeGraphQL(data: unknown) {
  return vi.fn().mockResolvedValue({
    json: async () => ({ data }),
  });
}

function makeClient(graphql: ReturnType<typeof vi.fn>) {
  return new InstalledShopifyClient(graphql as any);
}

describe("InstalledShopifyClient.updateVariants", () => {
  it("sends sku in inventoryItem mutation variables", async () => {
    const graphql = makeGraphQL({
      productVariantsBulkUpdate: {
        productVariants: [{ id: VARIANT_GID }],
        userErrors: [],
      },
    });
    const client = makeClient(graphql);
    await client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, sku: "NEW-SKU" }]);

    const [, opts] = graphql.mock.calls[0];
    expect(opts.variables.variants[0].inventoryItem.sku).toBe("NEW-SKU");
    expect(graphql.mock.calls[0][0]).toContain("productVariantsBulkUpdate");
  });

  it("sends price, compareAtPrice, cost in single mutation", async () => {
    const graphql = makeGraphQL({
      productVariantsBulkUpdate: { productVariants: [{ id: VARIANT_GID }], userErrors: [] },
    });
    const client = makeClient(graphql);
    const result = await client.updateVariants(PRODUCT_GID, [
      { id: VARIANT_GID, price: "19.99", compareAtPrice: "24.99", cost: "10.00" },
    ]);

    expect(result.userErrors).toHaveLength(0);
    const [, opts] = graphql.mock.calls[0];
    const variant = opts.variables.variants[0];
    expect(variant.price).toBe("19.99");
    expect(variant.compareAtPrice).toBe("24.99");
    expect(variant.inventoryItem.cost).toBe("10.00");
  });

  it("omits undefined fields from mutation variables", async () => {
    const graphql = makeGraphQL({
      productVariantsBulkUpdate: { productVariants: [{ id: VARIANT_GID }], userErrors: [] },
    });
    const client = makeClient(graphql);
    await client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, price: "9.99" }]);

    const [, opts] = graphql.mock.calls[0];
    const variant = opts.variables.variants[0];
    expect(variant.price).toBe("9.99");
    expect("compareAtPrice" in variant).toBe(false);
    expect("inventoryItem" in variant).toBe(false);
  });

  it("returns userErrors from Shopify response", async () => {
    const graphql = makeGraphQL({
      productVariantsBulkUpdate: {
        productVariants: [],
        userErrors: [{ field: ["variants", "0", "price"], message: "Price is not a number" }],
      },
    });
    const client = makeClient(graphql);
    const result = await client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, price: "bad" }]);
    expect(result.userErrors).toHaveLength(1);
    expect(result.userErrors[0]?.message).toBe("Price is not a number");
  });

  it("normalizes numeric variant ID to full GID", async () => {
    const graphql = makeGraphQL({
      productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
    });
    const client = makeClient(graphql);
    await client.updateVariants(PRODUCT_GID, [{ id: "222", price: "9.99" }]);

    const [, opts] = graphql.mock.calls[0];
    expect(opts.variables.variants[0].id).toBe("gid://shopify/ProductVariant/222");
  });

  it("throws ShopifyClientError on GraphQL errors", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({ data: null, errors: [{ message: "Internal error" }] }),
    });
    const client = makeClient(graphql);
    await expect(
      client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, price: "9.99" }])
    ).rejects.toThrow(ShopifyClientError);
  });
});

describe("InstalledShopifyClient.resolveSkuToIds", () => {
  it("returns variantId and productId for unique SKU", async () => {
    const graphql = makeGraphQL({
      productVariants: {
        edges: [{ node: { id: VARIANT_GID, product: { id: PRODUCT_GID } } }],
      },
    });
    const client = makeClient(graphql);
    const result = await client.resolveSkuToIds("SKU-001");
    expect(result.variantId).toBe(VARIANT_GID);
    expect(result.productId).toBe(PRODUCT_GID);
  });

  it("throws with 'SKU not found' when 0 results", async () => {
    const graphql = makeGraphQL({ productVariants: { edges: [] } });
    const client = makeClient(graphql);
    await expect(client.resolveSkuToIds("MISSING")).rejects.toThrow("SKU not found");
  });

  it("throws with 'SKU matches multiple variants' when 2+ results", async () => {
    const graphql = makeGraphQL({
      productVariants: {
        edges: [
          { node: { id: "gid://shopify/ProductVariant/1", product: { id: PRODUCT_GID } } },
          { node: { id: "gid://shopify/ProductVariant/2", product: { id: PRODUCT_GID } } },
        ],
      },
    });
    const client = makeClient(graphql);
    await expect(client.resolveSkuToIds("DUPE")).rejects.toThrow("SKU matches multiple variants");
  });

  it("uses first: 2 in the query", async () => {
    const graphql = makeGraphQL({
      productVariants: { edges: [{ node: { id: VARIANT_GID, product: { id: PRODUCT_GID } } }] },
    });
    const client = makeClient(graphql);
    await client.resolveSkuToIds("SKU-001");
    expect(graphql.mock.calls[0][0]).toContain("first: 2");
  });

  it("searches by exact SKU field with quoting and escaping", async () => {
    const graphql = makeGraphQL({
      productVariants: { edges: [{ node: { id: VARIANT_GID, product: { id: PRODUCT_GID } } }] },
    });
    const client = makeClient(graphql);
    await client.resolveSkuToIds('SKU "001"');

    const [, opts] = graphql.mock.calls[0];
    expect(opts.variables.sku).toBe('sku:"SKU \\"001\\""');
  });

  it("wraps plain SKU in field-scoped sku:\"...\" query", async () => {
    const graphql = makeGraphQL({
      productVariants: { edges: [{ node: { id: VARIANT_GID, product: { id: PRODUCT_GID } } }] },
    });
    const client = makeClient(graphql);
    await client.resolveSkuToIds("SKU-001");

    const [, opts] = graphql.mock.calls[0];
    expect(opts.variables.sku).toBe('sku:"SKU-001"');
  });
});

describe("InstalledShopifyClient.updateProduct", () => {
  it("sends productUpdate mutation with only non-empty fields", async () => {
    const graphql = makeGraphQL({
      productUpdate: { product: { id: PRODUCT_GID }, userErrors: [] },
    });
    const client = makeClient(graphql);
    await client.updateProduct(PRODUCT_GID, { title: "New Title", vendor: "Acme" });

    const [query, opts] = graphql.mock.calls[0];
    expect(query).toContain("productUpdate");
    expect(opts.variables.input.title).toBe("New Title");
    expect(opts.variables.input.vendor).toBe("Acme");
    expect("descriptionHtml" in opts.variables.input).toBe(false);
    expect("productType" in opts.variables.input).toBe(false);
  });

  it("sends all fields when all are provided", async () => {
    const graphql = makeGraphQL({
      productUpdate: { product: { id: PRODUCT_GID }, userErrors: [] },
    });
    const client = makeClient(graphql);
    await client.updateProduct(PRODUCT_GID, {
      title: "T",
      descriptionHtml: "<p>D</p>",
      vendor: "V",
      productType: "PT",
    });

    const [, opts] = graphql.mock.calls[0];
    expect(opts.variables.input.title).toBe("T");
    expect(opts.variables.input.descriptionHtml).toBe("<p>D</p>");
    expect(opts.variables.input.vendor).toBe("V");
    expect(opts.variables.input.productType).toBe("PT");
  });

  it("normalizes numeric product ID to full GID", async () => {
    const graphql = makeGraphQL({
      productUpdate: { product: { id: PRODUCT_GID }, userErrors: [] },
    });
    const client = makeClient(graphql);
    await client.updateProduct("111", { title: "T" });

    const [, opts] = graphql.mock.calls[0];
    expect(opts.variables.input.id).toBe("gid://shopify/Product/111");
  });

  it("returns userErrors from response", async () => {
    const graphql = makeGraphQL({
      productUpdate: {
        product: null,
        userErrors: [{ field: ["title"], message: "Title is too long" }],
      },
    });
    const client = makeClient(graphql);
    const result = await client.updateProduct(PRODUCT_GID, { title: "x".repeat(300) });
    expect(result.userErrors).toHaveLength(1);
    expect(result.userErrors[0]?.message).toBe("Title is too long");
  });
});

describe("InstalledShopifyClient.fetchProductTags", () => {
  it("returns tags array from response", async () => {
    const graphql = makeGraphQL({ product: { tags: ["tag-a", "tag-b"] } });
    const client = makeClient(graphql);
    const tags = await client.fetchProductTags(PRODUCT_GID);
    expect(tags).toEqual(["tag-a", "tag-b"]);
  });

  it("normalizes numeric product ID to full GID in query", async () => {
    const graphql = makeGraphQL({ product: { tags: [] } });
    const client = makeClient(graphql);
    await client.fetchProductTags("111");

    const [, opts] = graphql.mock.calls[0];
    expect(opts.variables.id).toBe("gid://shopify/Product/111");
  });

  it("throws ShopifyClientError when product not found", async () => {
    const graphql = makeGraphQL({ product: null });
    const client = makeClient(graphql);
    await expect(client.fetchProductTags(PRODUCT_GID)).rejects.toThrow("Product not found");
  });
});

describe("InstalledShopifyClient.resolveHandleToProductId", () => {
  it("returns productId GID for found handle", async () => {
    const graphql = makeGraphQL({ product: { id: "gid://shopify/Product/999" } });
    const client = makeClient(graphql);
    const id = await client.resolveHandleToProductId("my-product");
    expect(id).toBe("gid://shopify/Product/999");
    const [, opts] = graphql.mock.calls[0];
    expect(opts.variables.identifier.handle).toBe("my-product");
  });

  it("throws ShopifyClientError('Handle not found') when product is null", async () => {
    const graphql = makeGraphQL({ product: null });
    const client = makeClient(graphql);
    await expect(client.resolveHandleToProductId("missing")).rejects.toThrow("Handle not found");
  });

  it("throws ShopifyClientError on graphql error", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({ data: null, errors: [{ message: "Server error" }] }),
    });
    const client = makeClient(graphql);
    await expect(client.resolveHandleToProductId("any-handle")).rejects.toThrow(ShopifyClientError);
  });
});

describe("InstalledShopifyClient.createVariants", () => {
  it("sends productVariantsBulkCreate mutation with productId and variant fields", async () => {
    const graphql = makeGraphQL({
      productVariantsBulkCreate: {
        productVariants: [{ id: "gid://shopify/ProductVariant/999" }],
        userErrors: [],
      },
    });
    const client = makeClient(graphql);

    await client.createVariants(PRODUCT_GID, [
      { sku: "NEW-SKU", price: "9.99", compareAtPrice: "14.99", cost: "3.00" },
    ]);

    const [query, opts] = graphql.mock.calls[0];
    expect(query).toContain("productVariantsBulkCreate");
    expect(opts.variables.productId).toBe(PRODUCT_GID);
    expect(opts.variables.variants).toHaveLength(1);
    const v = opts.variables.variants[0];
    expect(v.price).toBe("9.99");
    expect(v.compareAtPrice).toBe("14.99");
    expect(v.inventoryItem.sku).toBe("NEW-SKU");
    expect(v.inventoryItem.cost).toBe("3.00");
  });

  it("omits fields absent from input", async () => {
    const graphql = makeGraphQL({
      productVariantsBulkCreate: { productVariants: [], userErrors: [] },
    });
    const client = makeClient(graphql);

    await client.createVariants(PRODUCT_GID, [{ price: "5.00" }]);

    const [, opts] = graphql.mock.calls[0];
    const v = opts.variables.variants[0];
    expect(v.price).toBe("5.00");
    expect("compareAtPrice" in v).toBe(false);
    expect("inventoryItem" in v).toBe(false);
  });

  it("returns userErrors from Shopify without throwing", async () => {
    const graphql = makeGraphQL({
      productVariantsBulkCreate: {
        productVariants: [],
        userErrors: [{ field: ["variants", "0", "price"], message: "Price is invalid" }],
      },
    });
    const client = makeClient(graphql);

    const result = await client.createVariants(PRODUCT_GID, [{ price: "bad" }]);
    expect(result.userErrors).toHaveLength(1);
    expect(result.userErrors[0]!.message).toBe("Price is invalid");
  });
});

describe("InstalledShopifyClient error handling", () => {
  it("throws ShopifyClientError when graphql function throws", async () => {
    const graphql = vi.fn().mockRejectedValue(new Error("Network error"));
    const client = makeClient(graphql);
    await expect(
      client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, price: "9.99" }])
    ).rejects.toThrow(ShopifyClientError);
  });

  it("throws ShopifyClientError when json parse fails", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => { throw new Error("invalid json"); },
    });
    const client = makeClient(graphql);
    await expect(
      client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, price: "9.99" }])
    ).rejects.toThrow(ShopifyClientError);
  });

  it("throws ShopifyClientError when data is null", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: async () => ({ data: null }),
    });
    const client = makeClient(graphql);
    await expect(
      client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, price: "9.99" }])
    ).rejects.toThrow(ShopifyClientError);
  });
});

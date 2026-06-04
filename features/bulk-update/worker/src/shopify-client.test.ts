import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShopifyClient, ShopifyClientError } from "./shopify-client";

const STORE_DOMAIN = "test-store.myshopify.com";
const ACCESS_TOKEN = "test-token";
const PRODUCT_GID = "gid://shopify/Product/111";
const VARIANT_GID = "gid://shopify/ProductVariant/222";

function makeClient(fetchFn: typeof fetch) {
  return new ShopifyClient(STORE_DOMAIN, ACCESS_TOKEN, fetchFn);
}

describe("ShopifyClient endpoint", () => {
  it("normalizes a full myshopify URL secret to hostname", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { productVariant: { product: { id: PRODUCT_GID } } } }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = new ShopifyClient(`https://${STORE_DOMAIN}/admin`, ACCESS_TOKEN, fetchFn);
    await client.resolveVariantToProductId(VARIANT_GID);

    expect(fetchFn.mock.calls[0][0]).toBe(
      `https://${STORE_DOMAIN}/admin/api/2026-04/graphql.json`
    );
  });

  it("rejects IP address store domains because Shopify returns Cloudflare 1003", () => {
    expect(
      () => new ShopifyClient("23.227.38.74", ACCESS_TOKEN, vi.fn() as unknown as typeof fetch)
    ).toThrow("SHOPIFY_STORE_DOMAIN must be a myshopify.com hostname, not an IP address");
  });

  it("rejects non-myshopify hostnames", () => {
    expect(
      () => new ShopifyClient("example.com", ACCESS_TOKEN, vi.fn() as unknown as typeof fetch)
    ).toThrow("SHOPIFY_STORE_DOMAIN must be a myshopify.com hostname");
  });
});

describe("ShopifyClient.updateVariants", () => {
  it("sends sku in inventoryItem mutation variables", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            productVariantsBulkUpdate: {
              productVariants: [{ id: VARIANT_GID, inventoryItem: { id: "gid://shopify/InventoryItem/333", sku: "NEW-SKU" } }],
              userErrors: [],
            },
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, sku: "NEW-SKU" }]);

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.variables.variants[0].inventoryItem.sku).toBe("NEW-SKU");
    expect(body.query).toContain("sku");
  });

  it("sends price, compareAtPrice, cost in single mutation", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            productVariantsBulkUpdate: {
              productVariants: [{ id: VARIANT_GID, price: "19.99", compareAtPrice: "24.99", inventoryItem: { id: "gid://shopify/InventoryItem/333", unitCost: { amount: "10.00" } } }],
              userErrors: [],
            },
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    const result = await client.updateVariants(PRODUCT_GID, [
      { id: VARIANT_GID, price: "19.99", compareAtPrice: "24.99", cost: "10.00" },
    ]);

    expect(result.userErrors).toHaveLength(0);
    expect(result.productVariants).toHaveLength(1);

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    const variant = body.variables.variants[0];
    expect(variant.price).toBe("19.99");
    expect(variant.compareAtPrice).toBe("24.99");
    expect(variant.inventoryItem.cost).toBe("10.00");
  });

  it("omits undefined fields from mutation variables", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { productVariantsBulkUpdate: { productVariants: [{ id: VARIANT_GID, price: "9.99", compareAtPrice: null, inventoryItem: { id: "gid://shopify/InventoryItem/333", unitCost: null } }], userErrors: [] } },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, price: "9.99" }]);

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    const variant = body.variables.variants[0];
    expect(variant.price).toBe("9.99");
    expect("compareAtPrice" in variant).toBe(false);
    expect("inventoryItem" in variant).toBe(false);
  });

  it("returns userErrors from Shopify response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            productVariantsBulkUpdate: {
              productVariants: [],
              userErrors: [{ field: ["variants", "0", "price"], message: "Price is not a number" }],
            },
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    const result = await client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, price: "bad" }]);
    expect(result.userErrors).toHaveLength(1);
    expect(result.userErrors[0]?.message).toBe("Price is not a number");
  });

  it("throws ShopifyClientError on HTTP error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );

    const client = makeClient(fetchFn);
    await expect(
      client.updateVariants(PRODUCT_GID, [{ id: VARIANT_GID, price: "9.99" }])
    ).rejects.toThrow(ShopifyClientError);
  });

  it("normalizes numeric variant ID to full GID", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { productVariantsBulkUpdate: { productVariants: [], userErrors: [] } } }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await client.updateVariants(PRODUCT_GID, [{ id: "222", price: "9.99" }]);

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.variables.variants[0].id).toBe("gid://shopify/ProductVariant/222");
  });
});

describe("ShopifyClient.resolveSkuToIds", () => {
  it("returns variantId and productId for unique SKU", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            productVariants: {
              edges: [
                { node: { id: VARIANT_GID, product: { id: PRODUCT_GID } } },
              ],
            },
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    const result = await client.resolveSkuToIds("SKU-001");
    expect(result.variantId).toBe(VARIANT_GID);
    expect(result.productId).toBe(PRODUCT_GID);
  });

  it("throws with 'SKU not found' when 0 results", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { productVariants: { edges: [] } } }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await expect(client.resolveSkuToIds("MISSING")).rejects.toThrow("SKU not found");
  });

  it("throws with 'SKU matches multiple variants' when 2+ results", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            productVariants: {
              edges: [
                { node: { id: "gid://shopify/ProductVariant/1", product: { id: PRODUCT_GID } } },
                { node: { id: "gid://shopify/ProductVariant/2", product: { id: PRODUCT_GID } } },
              ],
            },
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await expect(client.resolveSkuToIds("DUPE")).rejects.toThrow("SKU matches multiple variants");
  });

  it("uses first: 2 in the query", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { productVariants: { edges: [{ node: { id: VARIANT_GID, product: { id: PRODUCT_GID } } }] } } }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await client.resolveSkuToIds("SKU-001");

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.query).toContain("first: 2");
  });

  it("throws ShopifyClientError on HTTP error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("Server Error", { status: 500 })
    );

    const client = makeClient(fetchFn);
    await expect(client.resolveSkuToIds("SKU-001")).rejects.toThrow(ShopifyClientError);
  });
});

describe("ShopifyClient.updateProduct", () => {
  const PRODUCT_GID = "gid://shopify/Product/111";

  it("sends productUpdate mutation with only non-empty fields", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            productUpdate: {
              product: { id: PRODUCT_GID },
              userErrors: [],
            },
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await client.updateProduct(PRODUCT_GID, { title: "New Title", vendor: "Acme" });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.query).toContain("productUpdate");
    expect(body.variables.input.title).toBe("New Title");
    expect(body.variables.input.vendor).toBe("Acme");
    expect("descriptionHtml" in body.variables.input).toBe(false);
    expect("productType" in body.variables.input).toBe(false);
  });

  it("sends all fields when all are provided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            productUpdate: {
              product: { id: PRODUCT_GID },
              userErrors: [],
            },
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await client.updateProduct(PRODUCT_GID, {
      title: "T",
      descriptionHtml: "<p>D</p>",
      vendor: "V",
      productType: "PT",
    });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.variables.input.title).toBe("T");
    expect(body.variables.input.descriptionHtml).toBe("<p>D</p>");
    expect(body.variables.input.vendor).toBe("V");
    expect(body.variables.input.productType).toBe("PT");
  });

  it("normalizes numeric product ID to full GID", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { productUpdate: { product: { id: PRODUCT_GID }, userErrors: [] } },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await client.updateProduct("111", { title: "T" });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.variables.input.id).toBe("gid://shopify/Product/111");
  });

  it("returns userErrors from response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            productUpdate: {
              product: null,
              userErrors: [{ field: ["title"], message: "Title is too long" }],
            },
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    const result = await client.updateProduct(PRODUCT_GID, { title: "x".repeat(300) });
    expect(result.userErrors).toHaveLength(1);
    expect(result.userErrors[0]?.message).toBe("Title is too long");
  });
});

describe("ShopifyClient.fetchProductTags", () => {
  const PRODUCT_GID = "gid://shopify/Product/111";

  it("returns tags array from response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { product: { tags: ["tag-a", "tag-b"] } },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    const tags = await client.fetchProductTags(PRODUCT_GID);
    expect(tags).toEqual(["tag-a", "tag-b"]);
  });

  it("normalizes numeric product ID to full GID in query", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { product: { tags: [] } } }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await client.fetchProductTags("111");

    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.variables.id).toBe("gid://shopify/Product/111");
  });

  it("throws ShopifyClientError when product not found", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { product: null } }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const client = makeClient(fetchFn);
    await expect(client.fetchProductTags(PRODUCT_GID)).rejects.toThrow("Product not found");
  });
});

describe("ShopifyClient.resolveHandleToProductId", () => {
  it("returns productId GID for found handle", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { product: { id: "gid://shopify/Product/999" } } }),
    });
    const client = new ShopifyClient("test-store.myshopify.com", "tok", mockFetch as unknown as typeof fetch);
    const id = await client.resolveHandleToProductId("my-product");
    expect(id).toBe("gid://shopify/Product/999");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.variables.identifier.handle).toBe("my-product");
  });

  it("throws ShopifyClientError('Handle not found') when product is null", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { product: null } }),
    });
    const client = new ShopifyClient("test-store.myshopify.com", "tok", mockFetch as unknown as typeof fetch);
    await expect(client.resolveHandleToProductId("missing")).rejects.toThrow("Handle not found");
  });

  it("throws ShopifyClientError on HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    });
    const client = new ShopifyClient("test-store.myshopify.com", "tok", mockFetch as unknown as typeof fetch);
    await expect(client.resolveHandleToProductId("any-handle")).rejects.toThrow(ShopifyClientError);
  });
});

describe("ShopifyClient.createVariants", () => {
  const okResponse = (overrides = {}) =>
    new Response(
      JSON.stringify({
        data: {
          productVariantsBulkCreate: {
            productVariants: [{ id: "gid://shopify/ProductVariant/999" }],
            userErrors: [],
            ...overrides,
          },
        },
      }),
      { headers: { "Content-Type": "application/json" } }
    );

  it("sends productVariantsBulkCreate mutation with productId and variant fields", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const client = makeClient(fetchFn);

    await client.createVariants(PRODUCT_GID, [{ sku: "NEW-SKU", price: "9.99", compareAtPrice: "14.99", cost: "3.00" }]);

    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.query).toContain("productVariantsBulkCreate");
    expect(body.variables.productId).toBe(PRODUCT_GID);
    expect(body.variables.variants).toHaveLength(1);
    const v = body.variables.variants[0];
    expect(v.price).toBe("9.99");
    expect(v.compareAtPrice).toBe("14.99");
    expect(v.inventoryItem.sku).toBe("NEW-SKU");
    expect(v.inventoryItem.cost).toBe("3.00");
  });

  it("omits fields absent from input — no undefined keys in payload", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const client = makeClient(fetchFn);

    await client.createVariants(PRODUCT_GID, [{ price: "5.00" }]);

    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    const v = body.variables.variants[0];
    expect(v.price).toBe("5.00");
    expect("compareAtPrice" in v).toBe(false);
    expect("inventoryItem" in v).toBe(false);
  });

  it("returns userErrors from Shopify without throwing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      okResponse({ userErrors: [{ field: ["variants", "0", "price"], message: "Price is invalid" }] })
    );
    const client = makeClient(fetchFn);

    const result = await client.createVariants(PRODUCT_GID, [{ price: "bad" }]);
    expect(result.userErrors).toHaveLength(1);
    expect(result.userErrors[0]!.message).toBe("Price is invalid");
  });
});

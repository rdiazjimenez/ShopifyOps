const API_VERSION = "2026-04";

export class ShopifyClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyClientError";
  }
}

export interface VariantInput {
  id: string;
  sku?: string;
  price?: string;
  compareAtPrice?: string;
  cost?: string;
}

export interface UpdateVariantsResult {
  productVariants: Array<{ id: string }>;
  userErrors: Array<{ field: string[]; message: string }>;
}

export interface ResolvedIds {
  variantId: string;
  productId: string;
}

export class ShopifyClient {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: typeof fetch;

  constructor(storeDomain: string, accessToken: string, fetchFn: typeof fetch = fetch.bind(globalThis)) {
    const hostname = normalizeStoreDomain(storeDomain);
    this.endpoint = `https://${hostname}/admin/api/${API_VERSION}/graphql.json`;
    console.log("[ShopifyClient] endpoint host:", hostname);
    this.headers = {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
      "User-Agent": "ShopifyOps-BulkUpdate/1.0",
    };
    this.fetchFn = fetchFn;
  }

  async updateVariants(productId: string, variants: VariantInput[]): Promise<UpdateVariantsResult> {
    const normalizedVariants = variants.map((v) => {
      const input: Record<string, unknown> = { id: normalizeVariantGid(v.id) };
      if (v.sku !== undefined) input["sku"] = v.sku;
      if (v.price !== undefined) input["price"] = v.price;
      if (v.compareAtPrice !== undefined) input["compareAtPrice"] = v.compareAtPrice;
      if (v.cost !== undefined) input["inventoryItem"] = { cost: v.cost };
      return input;
    });

    const result = await this.graphql<{
      productVariantsBulkUpdate: UpdateVariantsResult;
    }>(
      `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id sku price compareAtPrice inventoryItem { id unitCost { amount } } }
          userErrors { field message }
        }
      }`,
      { productId, variants: normalizedVariants }
    );

    return result.productVariantsBulkUpdate;
  }

  async resolveVariantToProductId(variantGid: string): Promise<string> {
    const result = await this.graphql<{
      productVariant: { product: { id: string } } | null;
    }>(
      `query resolveVariantToProductId($id: ID!) {
        productVariant(id: $id) { product { id } }
      }`,
      { id: variantGid }
    );

    if (!result.productVariant) {
      throw new ShopifyClientError("Variant not found");
    }
    return result.productVariant.product.id;
  }

  async resolveSkuToIds(sku: string): Promise<ResolvedIds> {
    const result = await this.graphql<{
      productVariants: {
        edges: Array<{ node: { id: string; product: { id: string } } }>;
      };
    }>(
      `query resolveSkuToIds($sku: String!) {
        productVariants(first: 2, query: $sku) {
          edges { node { id product { id } } }
        }
      }`,
      { sku }
    );

    const edges = result.productVariants.edges;
    if (edges.length === 0) throw new ShopifyClientError("SKU not found");
    if (edges.length >= 2) throw new ShopifyClientError("SKU matches multiple variants");

    const node = edges[0]!.node;
    return { variantId: node.id, productId: node.product.id };
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ query, variables }),
        // bypass Cloudflare edge when calling Shopify (also CF-proxied)
        // @ts-ignore — CF Workers-specific option
        cf: { cacheTtl: 0, cacheEverything: false },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ShopifyClient] fetch error:", msg);
      throw new ShopifyClientError(`Shopify fetch error: ${msg}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[ShopifyClient] HTTP error:", res.status, body.slice(0, 200));
      throw new ShopifyClientError(`Shopify API error: ${res.status} ${res.statusText}`);
    }

    let json: { data: T | null; errors?: unknown[] };
    try {
      json = await res.json() as { data: T | null; errors?: unknown[] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ShopifyClient] JSON parse error:", msg);
      throw new ShopifyClientError(`Shopify response parse error: ${msg}`);
    }

    if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      console.error("[ShopifyClient] GraphQL errors:", JSON.stringify(json.errors));
      throw new ShopifyClientError(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    if (json.data === null || json.data === undefined) {
      console.error("[ShopifyClient] null data, full response:", JSON.stringify(json));
      throw new ShopifyClientError(`Shopify returned null data`);
    }

    return json.data;
  }
}

function normalizeStoreDomain(storeDomain: string): string {
  const raw = storeDomain.trim();
  if (!raw) throw new ShopifyClientError("SHOPIFY_STORE_DOMAIN is empty");

  let hostname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      hostname = new URL(raw).hostname;
    } catch {
      throw new ShopifyClientError("SHOPIFY_STORE_DOMAIN is not a valid URL");
    }
  } else {
    hostname = raw.split("/")[0] ?? "";
  }

  hostname = hostname.trim().toLowerCase().replace(/\.$/, "");

  if (!hostname) throw new ShopifyClientError("SHOPIFY_STORE_DOMAIN is empty");
  if (isIpAddress(hostname)) {
    throw new ShopifyClientError("SHOPIFY_STORE_DOMAIN must be a myshopify.com hostname, not an IP address");
  }
  if (!hostname.endsWith(".myshopify.com")) {
    throw new ShopifyClientError("SHOPIFY_STORE_DOMAIN must be a myshopify.com hostname");
  }

  return hostname;
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function normalizeVariantGid(id: string): string {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/ProductVariant/${id}`;
}

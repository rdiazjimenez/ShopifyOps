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


export interface ProductInput {
  title?: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  status?: string;
  tags?: string[];
}

export interface UpdateProductResult {
  product: { id: string } | null;
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
      if (v.price !== undefined) input["price"] = v.price;
      if (v.compareAtPrice !== undefined) input["compareAtPrice"] = v.compareAtPrice;
      const inventoryItem: Record<string, string> = {};
      if (v.sku !== undefined) inventoryItem["sku"] = v.sku;
      if (v.cost !== undefined) inventoryItem["cost"] = v.cost;
      if (Object.keys(inventoryItem).length > 0) input["inventoryItem"] = inventoryItem;
      return input;
    });

    const result = await this.graphql<{
      productVariantsBulkUpdate: UpdateVariantsResult;
    }>(
      `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price compareAtPrice inventoryItem { id sku unitCost { amount } } }
          userErrors { field message }
        }
      }`,
      { productId, variants: normalizedVariants }
    );

    return result.productVariantsBulkUpdate;
  }

  /**
   * Updates product-level fields via the productUpdate mutation.
   * Only non-undefined fields in input are included.
   * Surfaces userErrors as a thrown error.
   * Validated against Shopify Admin API schema (2026-04).
   */
  async updateProduct(productId: string, input: ProductInput): Promise<UpdateProductResult> {
    const productInput: Record<string, unknown> = { id: normalizeProductGid(productId) };
    if (input.title !== undefined) productInput['title'] = input.title;
    if (input.descriptionHtml !== undefined) productInput['descriptionHtml'] = input.descriptionHtml;
    if (input.vendor !== undefined) productInput['vendor'] = input.vendor;
    if (input.productType !== undefined) productInput['productType'] = input.productType;
    if (input.status !== undefined) productInput['status'] = input.status;
    if (input.tags !== undefined) productInput['tags'] = input.tags;

    const result = await this.graphql<{
      productUpdate: UpdateProductResult;
    }>(
      `mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id }
          userErrors { field message }
        }
      }`,
      { input: productInput }
    );

    return result.productUpdate;
  }

  /**
   * Fetches the current tags array for a product.
   * Called only during MERGE mode — never during REPLACE or dry-run.
   * Validated against Shopify Admin API schema (2026-04).
   */
  async fetchProductTags(productId: string): Promise<string[]> {
    const result = await this.graphql<{
      product: { tags: string[] } | null;
    }>(
      `query fetchProductTags($id: ID!) {
        product(id: $id) { tags }
      }`,
      { id: normalizeProductGid(productId) }
    );

    if (!result.product) {
      throw new ShopifyClientError("Product not found");
    }
    return result.product.tags;
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
    const query = `sku:${quoteSearchValue(sku)}`;
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
      { sku: query }
    );

    const edges = result.productVariants.edges;
    if (edges.length === 0) throw new ShopifyClientError("SKU not found");
    if (edges.length >= 2) throw new ShopifyClientError("SKU matches multiple variants");

    const node = edges[0]!.node;
    return { variantId: node.id, productId: node.product.id };
  }

  async resolveProductToSingleVariantId(productId: string): Promise<string> {
    const result = await this.graphql<{
      product: { variants: { edges: Array<{ node: { id: string } }> } } | null;
    }>(
      `query resolveProductToSingleVariantId($id: ID!) {
        product(id: $id) {
          variants(first: 2) { edges { node { id } } }
        }
      }`,
      { id: normalizeProductGid(productId) }
    );

    if (!result.product) throw new ShopifyClientError("Product not found");
    const edges = result.product.variants.edges;
    if (edges.length === 0) throw new ShopifyClientError("Product has no variants");
    if (edges.length >= 2) throw new ShopifyClientError("Product has multiple variants — Variant ID required");
    return edges[0]!.node.id;
  }

  async resolveHandleToProductId(handle: string): Promise<string> {
    const result = await this.graphql<{
      product: { id: string } | null;
    }>(
      `query resolveHandleToProductId($identifier: ProductIdentifierInput!) {
        product: productByIdentifier(identifier: $identifier) { id }
      }`,
      { identifier: { handle } }
    );

    if (!result.product) {
      throw new ShopifyClientError("Handle not found");
    }
    return result.product.id;
  }

  async createVariants(productId: string, variants: Array<{ sku?: string; price?: string; compareAtPrice?: string; cost?: string }>): Promise<UpdateVariantsResult> {
    const normalizedVariants = variants.map((v) => {
      const input: Record<string, unknown> = {};
      if (v.price !== undefined) input["price"] = v.price;
      if (v.compareAtPrice !== undefined) input["compareAtPrice"] = v.compareAtPrice;
      const inventoryItem: Record<string, string> = {};
      if (v.sku !== undefined) inventoryItem["sku"] = v.sku;
      if (v.cost !== undefined) inventoryItem["cost"] = v.cost;
      if (Object.keys(inventoryItem).length > 0) input["inventoryItem"] = inventoryItem;
      return input;
    });

    const result = await this.graphql<{
      productVariantsBulkCreate: UpdateVariantsResult;
    }>(
      `mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }`,
      { productId, variants: normalizedVariants }
    );

    return result.productVariantsBulkCreate;
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

function normalizeProductGid(id: string): string {
  if (id.startsWith('gid://')) return id;
  return `gid://shopify/Product/${id}`;
}

function quoteSearchValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

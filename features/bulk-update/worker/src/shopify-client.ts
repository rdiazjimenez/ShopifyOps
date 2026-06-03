const API_VERSION = "2025-04";

export class ShopifyClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyClientError";
  }
}

export interface VariantInput {
  id: string;
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

  constructor(storeDomain: string, accessToken: string, fetchFn: typeof fetch = fetch) {
    this.endpoint = `https://${storeDomain}/admin/api/${API_VERSION}/graphql.json`;
    this.headers = {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    };
    this.fetchFn = fetchFn;
  }

  async updateVariants(productId: string, variants: VariantInput[]): Promise<UpdateVariantsResult> {
    const normalizedVariants = variants.map((v) => {
      const input: Record<string, unknown> = { id: normalizeVariantGid(v.id) };
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
          productVariants { id price compareAtPrice inventoryItem { id unitCost { amount } } }
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
    const res = await this.fetchFn(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new ShopifyClientError(`Shopify API error: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as { data: T; errors?: unknown[] };
    if (json.errors?.length) {
      throw new ShopifyClientError(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    return json.data;
  }
}

function normalizeVariantGid(id: string): string {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/ProductVariant/${id}`;
}

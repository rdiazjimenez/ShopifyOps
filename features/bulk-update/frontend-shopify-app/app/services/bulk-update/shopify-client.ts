// BulkUpdateShopifyClient is the interface that abstracts Shopify Admin GraphQL transport.
// InstalledShopifyClient implements it using admin.graphql() from authenticate.admin().
// The frozen worker's ShopifyClient implements it using fetch with env var credentials.

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

export interface BulkUpdateShopifyClient {
  resolveVariantToProductId(variantGid: string): Promise<string>;
  resolveSkuToIds(sku: string): Promise<ResolvedIds>;
  resolveProductToSingleVariantId(productId: string): Promise<string>;
  resolveHandleToProductId(handle: string): Promise<string>;
  fetchProductTags(productId: string): Promise<string[]>;
  updateVariants(productId: string, variants: VariantInput[]): Promise<UpdateVariantsResult>;
  updateProduct(productId: string, input: ProductInput): Promise<UpdateProductResult>;
  createVariants(
    productId: string,
    variants: Array<{ sku?: string; price?: string; compareAtPrice?: string; cost?: string }>
  ): Promise<UpdateVariantsResult>;
}

export type AdminGraphQL = (
  query: string,
  options?: { variables?: Record<string, unknown> }
) => Promise<{ json(): Promise<unknown> }>;

export class InstalledShopifyClient implements BulkUpdateShopifyClient {
  constructor(private readonly graphql: AdminGraphQL) {}

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

    const result = await this.query<{
      productVariantsBulkUpdate: UpdateVariantsResult;
    }>(
      `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }`,
      { productId, variants: normalizedVariants }
    );

    return result.productVariantsBulkUpdate;
  }

  async updateProduct(productId: string, input: ProductInput): Promise<UpdateProductResult> {
    const productInput: Record<string, unknown> = { id: normalizeProductGid(productId) };
    if (input.title !== undefined) productInput["title"] = input.title;
    if (input.descriptionHtml !== undefined) productInput["descriptionHtml"] = input.descriptionHtml;
    if (input.vendor !== undefined) productInput["vendor"] = input.vendor;
    if (input.productType !== undefined) productInput["productType"] = input.productType;
    if (input.status !== undefined) productInput["status"] = input.status;
    if (input.tags !== undefined) productInput["tags"] = input.tags;

    const result = await this.query<{
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

  async fetchProductTags(productId: string): Promise<string[]> {
    const result = await this.query<{
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
    const result = await this.query<{
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
    const skuQuery = `sku:${quoteSearchValue(sku)}`;
    const result = await this.query<{
      productVariants: {
        edges: Array<{ node: { id: string; product: { id: string } } }>;
      };
    }>(
      `query resolveSkuToIds($sku: String!) {
        productVariants(first: 2, query: $sku) {
          edges { node { id product { id } } }
        }
      }`,
      { sku: skuQuery }
    );

    const edges = result.productVariants.edges;
    if (edges.length === 0) throw new ShopifyClientError("SKU not found");
    if (edges.length >= 2) throw new ShopifyClientError("SKU matches multiple variants");

    const node = edges[0]!.node;
    return { variantId: node.id, productId: node.product.id };
  }

  async resolveProductToSingleVariantId(productId: string): Promise<string> {
    const result = await this.query<{
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
    const result = await this.query<{
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

  async createVariants(
    productId: string,
    variants: Array<{ sku?: string; price?: string; compareAtPrice?: string; cost?: string }>
  ): Promise<UpdateVariantsResult> {
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

    const result = await this.query<{
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

  private async query<T>(queryStr: string, variables: Record<string, unknown>): Promise<T> {
    let res: { json(): Promise<unknown> };
    try {
      res = await this.graphql(queryStr, { variables });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ShopifyClientError(`Shopify fetch error: ${msg}`);
    }

    let json: { data: T | null; errors?: unknown[] };
    try {
      json = (await res.json()) as { data: T | null; errors?: unknown[] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ShopifyClientError(`Shopify response parse error: ${msg}`);
    }

    if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      throw new ShopifyClientError(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    if (json.data === null || json.data === undefined) {
      throw new ShopifyClientError(`Shopify returned null data`);
    }

    return json.data;
  }
}

function normalizeVariantGid(id: string): string {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/ProductVariant/${id}`;
}

function normalizeProductGid(id: string): string {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/Product/${id}`;
}

function quoteSearchValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

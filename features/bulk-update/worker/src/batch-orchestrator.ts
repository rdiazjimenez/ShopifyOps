import type { ParsedRow } from "./excel-parser";
import type { ShopifyClient, VariantInput, ProductInput } from "./shopify-client";
import { processRow } from "./row-processor";
import type { ProductFields } from "./row-processor";

const VALID_STATUS_VALUES = new Set(["ACTIVE", "DRAFT", "ARCHIVED", "UNLISTED"]);

export interface RowResult {
  row: number;
  lookupKey: string;
  status: "success" | "failed" | "skipped";
  reason?: string;
}

export interface ResultReport {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  rows: RowResult[];
}

export async function runBatch(
  parsedRows: ParsedRow[],
  client: ShopifyClient,
  dryRun: boolean
): Promise<ResultReport> {
  const processed = await Promise.all(parsedRows.map((row) => processRow(row, client)));

  // Group pending rows by productId, preserving insertion order.
  // Product-path rows (productPath: true) enforce the product-path First-Row Rule:
  // the first product-path row for a productId fires productUpdate;
  // subsequent product-path rows for the same productId are skipped as "duplicate product row".
  const pendingByProduct = new Map<string, Array<{ row: number; lookupKey: string; variantInput: VariantInput; productFields?: ProductFields; productPath?: true; createVariant?: true }>>();
  const productSeen = new Set<string>();
  const productPathDuplicates = new Set<number>();

  for (const p of processed) {
    if (p.type === "pending") {
      if (p.productPath) {
        if (productSeen.has(p.productId)) {
          productPathDuplicates.add(p.row);
          continue;
        }
      }
      const group = pendingByProduct.get(p.productId) ?? [];
      group.push({ row: p.row, lookupKey: p.lookupKey, variantInput: p.variantInput, productFields: p.productFields, productPath: p.productPath, createVariant: p.createVariant });
      pendingByProduct.set(p.productId, group);
      productSeen.add(p.productId);
    }
  }

  const rows: RowResult[] = [];
  let succeeded = 0;
  let skipped = 0;

  for (const p of processed) {
    if (p.type === "failed") {
      rows.push({ row: p.row, lookupKey: p.lookupKey, status: "failed", reason: p.reason });
    } else if (p.type === "skipped") {
      rows.push({ row: p.row, lookupKey: p.lookupKey, status: "skipped", reason: p.reason });
      skipped++;
    } else if (p.type === "pending" && productPathDuplicates.has(p.row)) {
      rows.push({ row: p.row, lookupKey: p.lookupKey, status: "skipped", reason: "duplicate product row" });
      skipped++;
    }
  }

  if (dryRun) {
    for (const group of pendingByProduct.values()) {
      for (const item of group) {
        rows.push({ row: item.row, lookupKey: item.lookupKey, status: "success" });
      }
      succeeded += group.length;
    }
  } else {
    for (const [productId, group] of pendingByProduct.entries()) {
      const firstRow = group[0]!;
      const productFields = group.find((g) => g.productPath)?.productFields ?? firstRow.productFields;

      let statusValidationError: string | undefined;
      let normalizedStatus: string | undefined;
      if (productFields?.status !== undefined) {
        normalizedStatus = productFields.status.toUpperCase();
        if (!VALID_STATUS_VALUES.has(normalizedStatus)) {
          statusValidationError = `Invalid Status value: "${productFields.status}". Accepted values: active, draft, archived, unlisted`;
        }
      }

      if (statusValidationError) {
        for (const item of group) {
          rows.push({ row: item.row, lookupKey: item.lookupKey, status: "failed", reason: statusValidationError });
        }
        continue;
      }

      try {
        let resolvedTags: string[] | undefined;
        if (productFields?.tags !== undefined) {
          const excelTags = productFields.tags.split(",").map((t) => t.trim()).filter(Boolean);
          const tagsCommand = (productFields.tagsCommand ?? "").toUpperCase();
          if (tagsCommand === "REPLACE") {
            resolvedTags = excelTags;
          } else {
            const existingTags = await client.fetchProductTags(productId);
            const merged = Array.from(new Set([...existingTags, ...excelTags]));
            resolvedTags = merged;
          }
        }

        // Product-path-only groups never call updateVariants.
        // Mixed groups (product-path + variant rows) still call updateVariants for the variant rows.
        // createVariant rows call createVariants instead of updateVariants.
        const hasUpdateVariantFields = group.some(
          (g) =>
            !g.productPath && !g.createVariant && (
              g.variantInput.sku !== undefined ||
              g.variantInput.price !== undefined ||
              g.variantInput.compareAtPrice !== undefined ||
              g.variantInput.cost !== undefined
            )
        );
        const createVariantRows = group.filter((g) => g.createVariant);
        const variantPromise = hasUpdateVariantFields
          ? client.updateVariants(productId, group.filter((g) => !g.productPath && !g.createVariant).map((g) => g.variantInput))
          : Promise.resolve<{ productVariants: []; userErrors: [] }>({ productVariants: [], userErrors: [] });
        const createVariantsPromise = createVariantRows.length > 0
          ? client.createVariants(productId, createVariantRows.map((g) => ({
              sku: g.variantInput.sku,
              price: g.variantInput.price,
              compareAtPrice: g.variantInput.compareAtPrice,
              cost: g.variantInput.cost,
            })))
          : Promise.resolve<{ productVariants: []; userErrors: [] }>({ productVariants: [], userErrors: [] });
        const productInput = productFields
          ? {
              title: productFields.title,
              descriptionHtml: productFields.bodyHtml,
              vendor: productFields.vendor,
              productType: productFields.productType,
              ...(normalizedStatus !== undefined ? { status: normalizedStatus } : {}),
              ...(resolvedTags !== undefined ? { tags: resolvedTags } : {}),
            }
          : null;
        const productPromise = productInput
          ? client.updateProduct(productId, productInput)
          : Promise.resolve(null);

        const [variantResult, productResult, createResult] = await Promise.all([variantPromise, productPromise, createVariantsPromise]);

        const reasons: string[] = [];
        if (variantResult.userErrors.length > 0) {
          reasons.push(...variantResult.userErrors.map((e) => e.message));
        }
        if (productResult && productResult.userErrors.length > 0) {
          reasons.push(...productResult.userErrors.map((e) => e.message));
        }
        if (createResult.userErrors.length > 0) {
          reasons.push(...createResult.userErrors.map((e) => e.message));
        }

        if (reasons.length > 0) {
          const reason = reasons.join("; ");
          for (const item of group) {
            rows.push({ row: item.row, lookupKey: item.lookupKey, status: "failed", reason });
          }
        } else {
          for (const item of group) {
            rows.push({ row: item.row, lookupKey: item.lookupKey, status: "success" });
          }
          succeeded += group.length;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Shopify update failed";
        for (const item of group) {
          rows.push({ row: item.row, lookupKey: item.lookupKey, status: "failed", reason });
        }
      }
    }
  }

  const failed = rows.filter((r) => r.status === "failed").length;
  const total = succeeded + failed + skipped;

  return { total, succeeded, failed, skipped, rows };
}

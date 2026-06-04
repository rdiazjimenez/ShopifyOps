import type { ParsedRow } from "./excel-parser";
import type { ShopifyClient, VariantInput, ProductInput } from "./shopify-client";
import { processRow } from "./row-processor";
import type { ProductFields } from "./row-processor";

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

  // Group pending rows by productId, preserving insertion order
  const pendingByProduct = new Map<string, Array<{ row: number; lookupKey: string; variantInput: VariantInput; productFields?: ProductFields }> >();
  for (const p of processed) {
    if (p.type === "pending") {
      const group = pendingByProduct.get(p.productId) ?? [];
      group.push({ row: p.row, lookupKey: p.lookupKey, variantInput: p.variantInput, productFields: p.productFields });
      pendingByProduct.set(p.productId, group);
    }
  }

  const rows: RowResult[] = [];
  let succeeded = 0;
  let skipped = 0;

  // Collect failed/skipped from resolution phase
  for (const p of processed) {
    if (p.type === "failed") {
      rows.push({ row: p.row, lookupKey: p.lookupKey, status: "failed", reason: p.reason });
    } else if (p.type === "skipped") {
      rows.push({ row: p.row, lookupKey: p.lookupKey, status: "skipped", reason: p.reason });
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
      // First-Row Rule: only the first row of a product group carries product fields.
      // Subsequent rows are treated as variant-only regardless of their product field cells.
      const firstRow = group[0]!;
      const productFields = firstRow.productFields;

      try {
        // Fire productUpdate and productVariantsBulkUpdate in parallel when product fields exist
        const variantPromise = client.updateVariants(productId, group.map((g) => g.variantInput));
        const productPromise = productFields
          ? client.updateProduct(productId, {
              title: productFields.title,
              descriptionHtml: productFields.bodyHtml,
              vendor: productFields.vendor,
              productType: productFields.productType,
            })
          : Promise.resolve(null);

        const [variantResult, productResult] = await Promise.all([variantPromise, productPromise]);

        // Collect failure reasons from both operations (strictest merge)
        const reasons: string[] = [];

        if (variantResult.userErrors.length > 0) {
          reasons.push(...variantResult.userErrors.map((e) => e.message));
        }
        if (productResult && productResult.userErrors.length > 0) {
          reasons.push(...productResult.userErrors.map((e) => e.message));
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

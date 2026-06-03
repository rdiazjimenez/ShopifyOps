import type { ParsedRow } from "./excel-parser";
import type { ShopifyClient, VariantInput } from "./shopify-client";
import { processRow } from "./row-processor";

export interface ResultReport {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ row: number; lookupKey: string; reason: string }>;
}

export async function runBatch(
  rows: ParsedRow[],
  client: ShopifyClient,
  dryRun: boolean
): Promise<ResultReport> {
  // Resolve all rows concurrently
  const processed = await Promise.all(rows.map((row) => processRow(row, client)));

  // Group pending rows by productId
  const pendingByProduct = new Map<string, Array<{ row: number; lookupKey: string; variantInput: VariantInput }>>();
  for (const p of processed) {
    if (p.type === "pending") {
      const group = pendingByProduct.get(p.productId) ?? [];
      group.push({ row: p.row, lookupKey: p.lookupKey, variantInput: p.variantInput });
      pendingByProduct.set(p.productId, group);
    }
  }

  const errors: ResultReport["errors"] = [];
  let succeeded = 0;

  // Collect failed/skipped from resolution phase
  let skipped = 0;
  for (const p of processed) {
    if (p.type === "failed") {
      errors.push({ row: p.row, lookupKey: p.lookupKey, reason: p.reason });
    } else if (p.type === "skipped") {
      skipped++;
    }
  }

  if (dryRun) {
    // In dry-run, pending rows count as succeeded (would have changed)
    for (const group of pendingByProduct.values()) {
      succeeded += group.length;
    }
  } else {
    // Execute one updateVariants per product
    for (const [productId, group] of pendingByProduct.entries()) {
      try {
        const result = await client.updateVariants(
          productId,
          group.map((g) => g.variantInput)
        );

        if (result.userErrors.length > 0) {
          // Map userErrors back to rows — all rows in this group are considered failed
          const reason = result.userErrors.map((e) => e.message).join("; ");
          for (const item of group) {
            errors.push({ row: item.row, lookupKey: item.lookupKey, reason });
          }
        } else {
          succeeded += group.length;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Shopify update failed";
        for (const item of group) {
          errors.push({ row: item.row, lookupKey: item.lookupKey, reason });
        }
      }
    }
  }

  const failed = errors.length;
  const total = succeeded + failed + skipped;

  return { total, succeeded, failed, skipped, errors };
}

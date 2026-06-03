import type { ParsedRow } from "./excel-parser";
import type { ShopifyClient, VariantInput } from "./shopify-client";
import { processRow } from "./row-processor";

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

  const pendingByProduct = new Map<string, Array<{ row: number; lookupKey: string; variantInput: VariantInput }>>();
  for (const p of processed) {
    if (p.type === "pending") {
      const group = pendingByProduct.get(p.productId) ?? [];
      group.push({ row: p.row, lookupKey: p.lookupKey, variantInput: p.variantInput });
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
      try {
        const result = await client.updateVariants(
          productId,
          group.map((g) => g.variantInput)
        );

        if (result.userErrors.length > 0) {
          const reason = result.userErrors.map((e) => e.message).join("; ");
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

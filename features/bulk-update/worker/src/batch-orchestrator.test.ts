import { describe, it, expect, vi } from "vitest";
import { runBatch } from "./batch-orchestrator";
import type { ShopifyClient } from "./shopify-client";
import { readFileSync } from "fs";
import { join } from "path";

const PRODUCT_A = "gid://shopify/Product/111";
const PRODUCT_B = "gid://shopify/Product/222";
const VARIANT_1 = "gid://shopify/ProductVariant/1";
const VARIANT_2 = "gid://shopify/ProductVariant/2";
const VARIANT_3 = "gid://shopify/ProductVariant/3";

function makeClient(overrides: Partial<ShopifyClient> = {}): ShopifyClient {
  return {
    updateVariants: vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] }),
    resolveSkuToIds: vi.fn(),
    resolveVariantToProductId: vi.fn(),
    ...overrides,
  } as unknown as ShopifyClient;
}

describe("runBatch — grouping", () => {
  it("batches variants of same product into one updateVariants call", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn()
        .mockResolvedValueOnce(PRODUCT_A)
        .mockResolvedValueOnce(PRODUCT_A),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_2, price: "14.99" },
    ];

    await runBatch(rows, client, false);
    expect(client.updateVariants).toHaveBeenCalledTimes(1);
    const call = (client.updateVariants as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(PRODUCT_A);
    expect(call[1]).toHaveLength(2);
  });

  it("makes separate updateVariants calls for different products", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn()
        .mockResolvedValueOnce(PRODUCT_A)
        .mockResolvedValueOnce(PRODUCT_B),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_2, price: "14.99" },
    ];

    await runBatch(rows, client, false);
    expect(client.updateVariants).toHaveBeenCalledTimes(2);
  });
});

describe("runBatch — Result Report", () => {
  it("total equals succeeded + failed + skipped", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_2 }, // no-op
      { skipped: true as const, row: 3, reason: "unsupported command: DELETE" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.total).toBe(3);
    expect(report.total).toBe(report.succeeded + report.failed + report.skipped);
  });

  it("failed row appears in errors, not skipped count", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockRejectedValue(new Error("Variant not found")),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.failed).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.row).toBe(1);
  });

  it("skipped row increments skipped, does not appear in errors", async () => {
    const client = makeClient();
    const rows = [
      { skipped: true as const, row: 1, reason: "unsupported command: NEW" },
    ];
    const report = await runBatch(rows, client, false);
    expect(report.skipped).toBe(1);
    expect(report.errors).toHaveLength(0);
  });

  it("failed row does not abort remaining rows", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn()
        .mockRejectedValueOnce(new Error("Variant not found"))
        .mockResolvedValueOnce(PRODUCT_A),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_2, price: "14.99" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.failed).toBe(1);
    expect(report.succeeded).toBe(1);
  });

  it("maps Shopify userErrors to failed rows", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants: vi.fn().mockResolvedValue({
        productVariants: [],
        userErrors: [{ field: ["variants", "0", "price"], message: "Price is invalid", variantId: VARIANT_1 }],
      }),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "bad" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.failed).toBe(1);
    expect(report.errors[0]?.reason).toContain("Price is invalid");
  });
});

describe("runBatch — dry run", () => {
  it("sends zero updateVariants calls", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_2, price: "14.99" },
    ];

    await runBatch(rows, client, true);
    expect(client.updateVariants).not.toHaveBeenCalled();
  });

  it("returns accurate Result Report without mutations", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_2 }, // no-op
    ];

    const report = await runBatch(rows, client, true);
    expect(report.total).toBe(2);
    expect(report.succeeded).toBe(1);
    expect(report.skipped).toBe(1);
    expect(client.updateVariants).not.toHaveBeenCalled();
  });
});

describe("runBatch — real fixture file", () => {
  it("processes Matrixify demo workbook without throwing", async () => {
    const { parseExcel } = await import("./excel-parser");
    const filePath = join(__dirname, "../../Matrixify-Import-Demo-Products.xlsx");
    const buffer = readFileSync(filePath).buffer;
    const rows = parseExcel(buffer, "Products");

    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      resolveSkuToIds: vi.fn().mockResolvedValue({ variantId: VARIANT_3, productId: PRODUCT_A }),
    });

    const report = await runBatch(rows, client, true);
    expect(report.total).toBe(report.succeeded + report.failed + report.skipped);
    expect(report.total).toBeGreaterThan(0);
  });
});

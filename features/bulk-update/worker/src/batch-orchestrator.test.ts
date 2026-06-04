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
  it("rows length equals total", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_2 }, // no-op
      { skipped: true as const, row: 3, reason: "unsupported command: DELETE" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.rows).toHaveLength(report.total);
  });

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

  it("failed row appears in rows with status failed, not skipped count", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockRejectedValue(new Error("Variant not found")),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.failed).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.rows.filter((r) => r.status === "failed")).toHaveLength(1);
    expect(report.rows.find((r) => r.status === "failed")?.row).toBe(1);
  });

  it("skipped row increments skipped, appears in rows with status skipped", async () => {
    const client = makeClient();
    const rows = [
      { skipped: true as const, row: 1, reason: "unsupported command: NEW" },
    ];
    const report = await runBatch(rows, client, false);
    expect(report.skipped).toBe(1);
    expect(report.rows.filter((r) => r.status === "failed")).toHaveLength(0);
    expect(report.rows.filter((r) => r.status === "skipped")).toHaveLength(1);
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
    expect(report.rows.find((r) => r.status === "failed")?.reason).toContain("Price is invalid");
  });

  it("group-level failure: all variants in product group marked failed when userErrors returned", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants: vi.fn().mockResolvedValue({
        productVariants: [],
        userErrors: [{ field: ["variants", "0", "price"], message: "Price is invalid" }],
      }),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "bad" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_2, price: "9.99" },
    ];

    const report = await runBatch(rows, client, false);
    // Both variants in the same product group fail together — Option A semantics
    expect(report.failed).toBe(2);
    expect(report.succeeded).toBe(0);
    expect(report.rows.every((r) => r.status === "failed")).toBe(true);
    expect(client.updateVariants).toHaveBeenCalledTimes(1);
  });
});

describe("runBatch — rows[] status per outcome", () => {
  it("succeeded row has status success and no reason", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
    });
    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
    ];
    const report = await runBatch(rows, client, false);
    const r = report.rows.find((r) => r.row === 1)!;
    expect(r.status).toBe("success");
    expect(r.reason).toBeUndefined();
  });

  it("failed row has status failed and reason present", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockRejectedValue(new Error("Variant not found")),
    });
    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
    ];
    const report = await runBatch(rows, client, false);
    const r = report.rows.find((r) => r.row === 1)!;
    expect(r.status).toBe("failed");
    expect(r.reason).toBeTruthy();
  });

  it("skipped row has status skipped and reason present", async () => {
    const client = makeClient();
    const rows = [
      { skipped: true as const, row: 1, reason: "unsupported command: DELETE" },
    ];
    const report = await runBatch(rows, client, false);
    const r = report.rows.find((r) => r.row === 1)!;
    expect(r.status).toBe("skipped");
    expect(r.reason).toBeTruthy();
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

  it("dry run pending rows appear as status success in rows[]", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
    });
    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
    ];
    const report = await runBatch(rows, client, true);
    const r = report.rows.find((r) => r.row === 1)!;
    expect(r.status).toBe("success");
  });
});

describe("runBatch — real fixture file", () => {
  it("processes Matrixify demo workbook without throwing", async () => {
    const { parseExcel } = await import("./excel-parser");
    const filePath = join(__dirname, "../../ImportProducts-Demo.xlsx");
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

describe("runBatch — product fields (First-Row Rule + parallel mutations)", () => {
  it("fires updateProduct for first row of product group when product fields present", async () => {
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", title: "New Title" },
    ];

    await runBatch(rows, client, false);
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[0][0]).toBe(PRODUCT_A);
    expect(updateProduct.mock.calls[0][1].title).toBe("New Title");
  });

  it("does not fire updateProduct when no product fields on first row", async () => {
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
    ];

    await runBatch(rows, client, false);
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("First-Row Rule: product fields from row 1 only; row 2 treated as variant-only", async () => {
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", title: "Title Row1" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_2, price: "14.99", title: "Title Row2" },
    ];

    await runBatch(rows, client, false);
    // updateProduct called once (for first row), not twice
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[0][1].title).toBe("Title Row1");
  });

  it("fires updateVariants and updateProduct in parallel (both called once per product)", async () => {
    const updateVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants,
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", title: "T" },
    ];

    await runBatch(rows, client, false);
    expect(updateVariants).toHaveBeenCalledTimes(1);
    expect(updateProduct).toHaveBeenCalledTimes(1);
  });

  it("row is failed if product update fails and variant succeeds", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants: vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] }),
      updateProduct: vi.fn().mockResolvedValue({
        product: null,
        userErrors: [{ field: ["title"], message: "Product update error" }],
      }),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", title: "T" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.failed).toBe(1);
    expect(report.succeeded).toBe(0);
    expect(report.rows[0]?.reason).toContain("Product update error");
  });

  it("row is failed if variant update fails and product succeeds", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants: vi.fn().mockResolvedValue({
        productVariants: [],
        userErrors: [{ field: ["price"], message: "Variant update error" }],
      }),
      updateProduct: vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] }),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "bad", title: "T" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.failed).toBe(1);
    expect(report.rows[0]?.reason).toContain("Variant update error");
  });

  it("failure reasons from both product and variant operations are concatenated", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants: vi.fn().mockResolvedValue({
        productVariants: [],
        userErrors: [{ field: ["price"], message: "Price invalid" }],
      }),
      updateProduct: vi.fn().mockResolvedValue({
        product: null,
        userErrors: [{ field: ["title"], message: "Title too long" }],
      }),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "bad", title: "T".repeat(300) },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.rows[0]?.reason).toContain("Price invalid");
    expect(report.rows[0]?.reason).toContain("Title too long");
  });

  it("skips updateVariants when group has only product fields (no price/sku/cost)", async () => {
    const updateVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants,
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, title: "New Title" },
    ];

    const report = await runBatch(rows, client, false);
    expect(updateVariants).not.toHaveBeenCalled();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(report.succeeded).toBe(1);
  });


  it("dry-run does not call updateProduct", async () => {
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", title: "T" },
    ];

    const report = await runBatch(rows, client, true);
    expect(updateProduct).not.toHaveBeenCalled();
    expect(report.succeeded).toBe(1);
  });
});

describe("runBatch — Status validation and normalisation (Slice 2)", () => {
  const validCases = ["active", "draft", "archived", "unlisted", "ACTIVE", "DRAFT", "ARCHIVED", "UNLISTED", "Active", "Draft"];

  validCases.forEach((statusVal) => {
    it(`accepts Status value "${statusVal}" and normalises to uppercase`, async () => {
      const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
      const client = makeClient({
        resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
        updateProduct,
      });

      const rows = [
        { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", status: statusVal },
      ];

      const report = await runBatch(rows, client, false);
      expect(report.succeeded).toBe(1);
      expect(updateProduct).toHaveBeenCalledTimes(1);
      expect(updateProduct.mock.calls[0][1].status).toBe(statusVal.toUpperCase());
    });
  });

  it("marks row as failed with descriptive reason for invalid Status value", async () => {
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", status: "pending" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.failed).toBe(1);
    expect(report.rows[0]?.reason).toContain("pending");
    expect(client.updateVariants).not.toHaveBeenCalled();
  });

  it("does not send productUpdate mutation for invalid Status", async () => {
    const updateProduct = vi.fn();
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", status: "unknown-val" },
    ];

    await runBatch(rows, client, false);
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("empty Status (no status field) does not add status to ProductInput", async () => {
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateProduct,
    });

    // Row has title but no status
    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", title: "T" },
    ];

    await runBatch(rows, client, false);
    const callArgs = updateProduct.mock.calls[0][1];
    expect("status" in callArgs).toBe(false);
  });
});

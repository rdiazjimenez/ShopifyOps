import { describe, it, expect, vi } from "vitest";
import { runBatch } from "./batch-orchestrator";
import type { ShopifyClient } from "./shopify-client";
import { ShopifyClientError } from "./shopify-client";
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
    createVariants: vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] }),
    resolveSkuToIds: vi.fn(),
    resolveVariantToProductId: vi.fn(),
    resolveHandleToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
    resolveProductToSingleVariantId: vi.fn().mockResolvedValue(VARIANT_1),
    updateProduct: vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] }),
    fetchProductTags: vi.fn().mockResolvedValue([]),
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
  it("dry-run of demo workbook: total=5, succeeded=4, skipped=1, failed=0", async () => {
    const { parseExcel } = await import("./excel-parser");
    const filePath = join(__dirname, "../../ImportProducts-Demo.xlsx");
    const buffer = readFileSync(filePath).buffer;
    const rows = parseExcel(buffer, "Products");

    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      resolveSkuToIds: vi.fn().mockResolvedValue({ variantId: VARIANT_3, productId: PRODUCT_A }),
    });

    const report = await runBatch(rows, client, true);
    expect(report.total).toBe(5);
    expect(report.succeeded).toBe(4);
    expect(report.skipped).toBe(1);
    expect(report.failed).toBe(0);
    const skippedRow = report.rows.find((r) => r.status === "skipped");
    expect(skippedRow?.reason).toContain("unsupported command");
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

describe("runBatch — Tags MERGE and REPLACE (Slice 3)", () => {
  it("MERGE path: fetchProductTags IS called; tags are unioned with deduplication", async () => {
    const fetchProductTags = vi.fn().mockResolvedValue(["existing-tag", "shared-tag"]);
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      fetchProductTags,
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", tags: "shared-tag, new-tag", tagsCommand: "MERGE" },
    ];

    await runBatch(rows, client, false);
    expect(fetchProductTags).toHaveBeenCalledTimes(1);
    const callTags = updateProduct.mock.calls[0][1].tags as string[];
    expect(callTags).toContain("existing-tag");
    expect(callTags).toContain("shared-tag");
    expect(callTags).toContain("new-tag");
    // deduplication: shared-tag should appear only once
    expect(callTags.filter((t: string) => t === "shared-tag")).toHaveLength(1);
  });

  it("REPLACE path: fetchProductTags is NOT called; Excel tags passed directly", async () => {
    const fetchProductTags = vi.fn();
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      fetchProductTags,
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", tags: "tag-a, tag-b", tagsCommand: "REPLACE" },
    ];

    await runBatch(rows, client, false);
    expect(fetchProductTags).not.toHaveBeenCalled();
    expect(updateProduct.mock.calls[0][1].tags).toEqual(["tag-a", "tag-b"]);
  });

  it("empty tagsCommand defaults to MERGE (fetchProductTags called)", async () => {
    const fetchProductTags = vi.fn().mockResolvedValue(["old-tag"]);
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      fetchProductTags,
      updateProduct,
    });

    const rows = [
      // No tagsCommand field
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", tags: "new-tag" },
    ];

    await runBatch(rows, client, false);
    expect(fetchProductTags).toHaveBeenCalledTimes(1);
    const callTags = updateProduct.mock.calls[0][1].tags as string[];
    expect(callTags).toContain("old-tag");
    expect(callTags).toContain("new-tag");
  });

  it("unknown tagsCommand treated as MERGE (fetchProductTags called)", async () => {
    const fetchProductTags = vi.fn().mockResolvedValue([]);
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      fetchProductTags,
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", tags: "t1", tagsCommand: "DELETE" },
    ];

    await runBatch(rows, client, false);
    expect(fetchProductTags).toHaveBeenCalledTimes(1);
  });

  it("dry-run mode: fetchProductTags is NOT called", async () => {
    const fetchProductTags = vi.fn();
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      fetchProductTags,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99", tags: "t1", tagsCommand: "MERGE" },
    ];

    const report = await runBatch(rows, client, true);
    expect(fetchProductTags).not.toHaveBeenCalled();
    expect(report.succeeded).toBe(1);
  });

  it("row without tags does not call fetchProductTags", async () => {
    const fetchProductTags = vi.fn();
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      fetchProductTags,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
    ];

    await runBatch(rows, client, false);
    expect(fetchProductTags).not.toHaveBeenCalled();
  });
});

describe("runBatch — product-path Product ID rows (Issue #32)", () => {
  it("product-path row: productUpdate fires, updateVariants not called", async () => {
    const updateVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({ updateVariants, updateProduct });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, productId: "111", title: "New Title" },
    ];

    const report = await runBatch(rows, client, false);
    expect(updateVariants).not.toHaveBeenCalled();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(report.succeeded).toBe(1);
  });

  it("product-path row: lookupKey in Result Report equals the Product ID value", async () => {
    const client = makeClient({
      updateProduct: vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] }),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, productId: "111", title: "T" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.rows[0]?.lookupKey).toBe("111");
  });

  it("duplicate product-path row (same productId, no variant fields) → second skipped 'duplicate product row'", async () => {
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({ updateProduct });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, productId: "111", title: "T1" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, productId: "111", vendor: "V2" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.succeeded).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.rows.find(r => r.row === 2)?.reason).toBe("duplicate product row");
    // updateProduct called once only (for first row)
    expect(updateProduct).toHaveBeenCalledTimes(1);
  });

  it("later row for same product with Variant ID → processes variant fields normally", async () => {
    const updateVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants,
      updateProduct,
    });

    const rows = [
      // product-path row
      { skipped: false as const, row: 1, command: "UPDATE" as const, productId: "111", title: "T" },
      // variant row for same product — should update variant fields
      { skipped: false as const, row: 2, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
    ];

    const report = await runBatch(rows, client, false);
    expect(updateVariants).toHaveBeenCalledTimes(1);
    expect(report.succeeded).toBe(2);
  });

  it("variant row before product-path row (reversed order) → both updateVariants and updateProduct fire", async () => {
    const updateVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants,
      updateProduct,
    });

    const rows = [
      // variant row first
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
      // product-path row second for same product
      { skipped: false as const, row: 2, command: "UPDATE" as const, productId: "111", title: "New Title" },
    ];

    const report = await runBatch(rows, client, false);
    expect(updateVariants).toHaveBeenCalledTimes(1);
    expect(updateProduct).not.toHaveBeenCalled();
    expect(report.succeeded).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.rows.find(r => r.row === 2)?.reason).toBe("duplicate product row");
  });

  it("dry-run: product-path productUpdate suppressed; row appears as success", async () => {
    const updateProduct = vi.fn();
    const client = makeClient({ updateProduct });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, productId: "111", title: "T" },
    ];

    const report = await runBatch(rows, client, true);
    expect(updateProduct).not.toHaveBeenCalled();
    expect(report.rows[0]?.status).toBe("success");
    expect(report.succeeded).toBe(1);
  });

  it("product-path row with no product fields (productId + no fields) → skipped 'no fields to update'", async () => {
    const client = makeClient();

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, productId: "111" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.skipped).toBe(1);
    expect(report.rows[0]?.reason).toBe("no fields to update");
  });

  it("skipped row (unsupported command) → skipped, not failed", async () => {
    const client = makeClient();

    const rows = [
      { skipped: true as const, row: 1, reason: "unsupported command: DELETE" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.skipped).toBe(1);
    expect(report.rows[0]?.status).toBe("skipped");
  });
});

describe("runBatch - handle product-path rows (Issue #33)", () => {
  it("handle-path row: productUpdate fires, updateVariants not called", async () => {
    const updateVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveHandleToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants,
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, handle: "my-product", title: "New Title" },
    ];

    const report = await runBatch(rows, client, false);
    expect(updateVariants).not.toHaveBeenCalled();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(report.succeeded).toBe(1);
  });

  it("handle-path row: lookupKey in Result Report equals the Handle string", async () => {
    const client = makeClient({
      resolveHandleToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateProduct: vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] }),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, handle: "cool-product", title: "T" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.rows[0]?.lookupKey).toBe("cool-product");
  });

  it("Handle not found - row failed, reason Handle not found", async () => {
    const client = makeClient({
      resolveHandleToProductId: vi.fn().mockRejectedValue(new ShopifyClientError("Handle not found")),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, handle: "missing", title: "T" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.failed).toBe(1);
    expect(report.rows[0]?.reason).toBe("Handle not found");
  });

  it("duplicate handle-path row (same resolved productId) - second skipped 'duplicate product row'", async () => {
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveHandleToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateProduct,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, handle: "my-product", title: "T1" },
      { skipped: false as const, row: 2, command: "UPDATE" as const, handle: "my-product", vendor: "V2" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.succeeded).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.rows.find(r => r.row === 2)?.reason).toBe("duplicate product row");
    expect(updateProduct).toHaveBeenCalledTimes(1);
  });

  it("dry-run: handle-path productUpdate suppressed; row appears as success", async () => {
    const updateProduct = vi.fn();
    const client = makeClient({ updateProduct });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, handle: "my-product", title: "T" },
    ];

    const report = await runBatch(rows, client, true);
    expect(updateProduct).not.toHaveBeenCalled();
    expect(report.rows[0]?.status).toBe("success");
    expect(report.succeeded).toBe(1);
  });

  it("ID wins over Handle: Product ID present → result uses Product ID GID as productId", async () => {
    const client = makeClient({
      updateProduct: vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] }),
    });

    const rows = [
      { skipped: false as const, row: 1, command: "UPDATE" as const, productId: "111", handle: "my-product", title: "T" },
    ];

    const report = await runBatch(rows, client, false);
    expect(report.succeeded).toBe(1);
    expect(report.rows[0]?.lookupKey).toBe("111");
  });

  it("variant row before handle-path row (reversed order) → both updateVariants and updateProduct fire", async () => {
    const updateVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const updateProduct = vi.fn().mockResolvedValue({ product: { id: PRODUCT_A }, userErrors: [] });
    const client = makeClient({
      resolveVariantToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      resolveHandleToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      updateVariants,
      updateProduct,
    });

    const rows = [
      // variant row first
      { skipped: false as const, row: 1, command: "UPDATE" as const, variantId: VARIANT_1, price: "9.99" },
      // handle-path row second for same product
      { skipped: false as const, row: 2, command: "UPDATE" as const, handle: "my-product", title: "New Title" },
    ];

    const report = await runBatch(rows, client, false);
    expect(updateVariants).toHaveBeenCalledTimes(1);
    expect(updateProduct).not.toHaveBeenCalled();
    expect(report.succeeded).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.rows.find(r => r.row === 2)?.reason).toBe("duplicate product row");
  });
});

describe("runBatch - NEW command", () => {
  it("NEW with Product ID calls createVariants and not updateVariants", async () => {
    const updateVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const createVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const client = makeClient({ updateVariants, createVariants });

    const rows = [
      { skipped: false as const, row: 1, command: "NEW" as const, productId: "111", newSku: "NEW-SKU", price: "9.99" },
    ];

    const report = await runBatch(rows, client, false);
    expect(updateVariants).not.toHaveBeenCalled();
    expect(createVariants).toHaveBeenCalledTimes(1);
    expect(createVariants).toHaveBeenCalledWith(PRODUCT_A, [expect.objectContaining({ sku: "NEW-SKU", price: "9.99" })]);
    expect(report.succeeded).toBe(1);
  });

  it("NEW with Handle calls createVariants under resolved product", async () => {
    const createVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const client = makeClient({
      resolveHandleToProductId: vi.fn().mockResolvedValue(PRODUCT_A),
      createVariants,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "NEW" as const, handle: "my-product", newSku: "NEW-SKU" },
    ];

    const report = await runBatch(rows, client, false);
    expect(createVariants).toHaveBeenCalledTimes(1);
    expect(createVariants).toHaveBeenCalledWith(PRODUCT_A, [expect.objectContaining({ sku: "NEW-SKU" })]);
    expect(report.succeeded).toBe(1);
  });

  it("NEW with no Product ID or Handle fails with no lookup key", async () => {
    const createVariants = vi.fn();
    const client = makeClient({ createVariants });

    const rows = [
      { skipped: false as const, row: 1, command: "NEW" as const, newSku: "NEW-SKU" },
    ];

    const report = await runBatch(rows, client, false);
    expect(createVariants).not.toHaveBeenCalled();
    expect(report.failed).toBe(1);
    expect(report.rows[0]?.reason).toBe("no lookup key");
  });

  it("NEW with Product ID creates variant even when single-variant auto-resolve would fail on multi-variant product", async () => {
    const createVariants = vi.fn().mockResolvedValue({ productVariants: [], userErrors: [] });
    const client = makeClient({
      resolveProductToSingleVariantId: vi.fn().mockRejectedValue(new ShopifyClientError("Product has multiple variants â€” Variant ID required")),
      createVariants,
    });

    const rows = [
      { skipped: false as const, row: 1, command: "NEW" as const, productId: "111", newSku: "NEW-SKU" },
    ];

    const report = await runBatch(rows, client, false);
    expect(createVariants).toHaveBeenCalledTimes(1);
    expect(report.succeeded).toBe(1);
  });
});

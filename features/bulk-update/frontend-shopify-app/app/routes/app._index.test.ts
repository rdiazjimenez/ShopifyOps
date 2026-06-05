import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../shopify.server", () => ({
  authenticate: { admin: vi.fn() },
}));

vi.mock("../services/bulk-update/excel-parser", () => ({
  parseExcel: vi.fn(),
}));

vi.mock("../services/bulk-update/batch-orchestrator", () => ({
  runBatch: vi.fn(),
}));

import { action } from "./app._index";
import { authenticate } from "../shopify.server";
import { parseExcel } from "../services/bulk-update/excel-parser";
import { runBatch } from "../services/bulk-update/batch-orchestrator";
import { InstalledShopifyClient } from "../services/bulk-update/shopify-client";

const mockGraphql = vi.fn();
const mockAdmin = { graphql: mockGraphql };

const EMPTY_REPORT = { total: 0, succeeded: 0, failed: 0, skipped: 0, rows: [] };

const XLSX_BLOB = new Blob(["data"], {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

function makeRequest(fields: Record<string, string | Blob | null> = {}): Request {
  const defaults: Record<string, string | Blob | null> = {
    file: XLSX_BLOB,
    sheet: "Products",
    dryRun: "false",
  };
  const merged = { ...defaults, ...fields };
  const fd = new FormData();
  for (const [key, value] of Object.entries(merged)) {
    if (value === null) continue;
    if (typeof value === "string") fd.append(key, value);
    else fd.append(key, value, "upload.xlsx");
  }
  return new Request("http://localhost/app", { method: "POST", body: fd });
}

describe("action — auth", () => {
  beforeEach(() => {
    vi.mocked(authenticate.admin).mockResolvedValue({ admin: mockAdmin } as any);
    vi.mocked(parseExcel).mockReturnValue([]);
    vi.mocked(runBatch).mockResolvedValue(EMPTY_REPORT);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("unauthenticated request throws before any processing", async () => {
    vi.mocked(authenticate.admin).mockRejectedValue(
      new Response(null, { status: 302, headers: { Location: "/auth" } }),
    );

    await expect(
      action({ request: makeRequest(), params: {}, context: {} as any }),
    ).rejects.toBeInstanceOf(Response);

    expect(parseExcel).not.toHaveBeenCalled();
    expect(runBatch).not.toHaveBeenCalled();
  });
});

describe("action — validation", () => {
  beforeEach(() => {
    vi.mocked(authenticate.admin).mockResolvedValue({ admin: mockAdmin } as any);
    vi.mocked(parseExcel).mockReturnValue([]);
    vi.mocked(runBatch).mockResolvedValue(EMPTY_REPORT);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("missing file returns 400 with descriptive error", async () => {
    const response = await action({
      request: makeRequest({ file: null }),
      params: {},
      context: {} as any,
    });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/file/i);
    expect(body.result).toBeNull();
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("missing sheet returns 400 with descriptive error", async () => {
    const response = await action({
      request: makeRequest({ sheet: null }),
      params: {},
      context: {} as any,
    });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/sheet/i);
    expect(body.result).toBeNull();
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("parseExcel error (sheet not found) returns 400 with error message", async () => {
    vi.mocked(parseExcel).mockImplementation(() => {
      throw new Error("Sheet not found: Missing");
    });
    const response = await action({
      request: makeRequest({ sheet: "Missing" }),
      params: {},
      context: {} as any,
    });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("Sheet not found");
    expect(body.result).toBeNull();
    expect(runBatch).not.toHaveBeenCalled();
  });
});

describe("action — direct execution", () => {
  beforeEach(() => {
    vi.mocked(authenticate.admin).mockResolvedValue({ admin: mockAdmin } as any);
    vi.mocked(parseExcel).mockReturnValue([]);
    vi.mocked(runBatch).mockResolvedValue(EMPTY_REPORT);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("authenticated request returns ResultReport with 200", async () => {
    const report = { total: 3, succeeded: 2, failed: 0, skipped: 1, rows: [] };
    vi.mocked(runBatch).mockResolvedValue(report);

    const response = await action({
      request: makeRequest(),
      params: {},
      context: {} as any,
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.result).toEqual(report);
    expect(body.error).toBeNull();
  });

  it("dry-run flag is forwarded to runBatch", async () => {
    await action({
      request: makeRequest({ dryRun: "true" }),
      params: {},
      context: {} as any,
    });
    const [, , dryRunArg] = vi.mocked(runBatch).mock.calls[0]!;
    expect(dryRunArg).toBe(true);
  });

  it("non-dry-run flag is forwarded as false", async () => {
    await action({
      request: makeRequest({ dryRun: "false" }),
      params: {},
      context: {} as any,
    });
    const [, , dryRunArg] = vi.mocked(runBatch).mock.calls[0]!;
    expect(dryRunArg).toBe(false);
  });

  it("InstalledShopifyClient is passed to runBatch", async () => {
    await action({ request: makeRequest(), params: {}, context: {} as any });
    const [, clientArg] = vi.mocked(runBatch).mock.calls[0]!;
    expect(clientArg).toBeInstanceOf(InstalledShopifyClient);
  });

  it("Shopify GraphQL error from runBatch returns 500 with clean error", async () => {
    vi.mocked(runBatch).mockRejectedValue(new Error("Shopify GraphQL errors: internal error"));

    const response = await action({
      request: makeRequest(),
      params: {},
      context: {} as any,
    });
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toContain("Shopify GraphQL errors");
    expect(body.result).toBeNull();
  });

  it("non-Error thrown from runBatch returns generic 500 message", async () => {
    vi.mocked(runBatch).mockRejectedValue("something went wrong");

    const response = await action({
      request: makeRequest(),
      params: {},
      context: {} as any,
    });
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(body.result).toBeNull();
  });
});

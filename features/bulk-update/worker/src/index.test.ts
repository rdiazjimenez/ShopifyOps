import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index";

const API_KEY = "test-api-key";
const STORE_DOMAIN = "test-store.myshopify.com";
const ACCESS_TOKEN = "test-token";

const env = {
  API_KEY,
  SHOPIFY_STORE_DOMAIN: STORE_DOMAIN,
  SHOPIFY_ACCESS_TOKEN: ACCESS_TOKEN,
};

// Stub runBatch so we don't need real Shopify calls
vi.mock("./batch-orchestrator", () => ({
  runBatch: vi.fn().mockResolvedValue({
    total: 1,
    succeeded: 1,
    failed: 0,
    skipped: 0,
    errors: [],
  }),
}));

vi.mock("./excel-parser", () => ({
  parseExcel: vi.fn().mockReturnValue([]),
}));

function makeXlsxFormData(): FormData {
  const fd = new FormData();
  // Minimal xlsx magic bytes
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  fd.append("file", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "test.xlsx");
  return fd;
}

function post(path: string, body: FormData | null, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      method: "POST",
      body,
      headers,
    }),
    env as never,
    {} as never
  );
}

describe("POST /bulk-update — auth", () => {
  it("returns 401 when X-Api-Key header is missing", async () => {
    const res = await post("/bulk-update?sheet=Products", makeXlsxFormData());
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when X-Api-Key is wrong", async () => {
    const res = await post("/bulk-update?sheet=Products", makeXlsxFormData(), { "X-Api-Key": "wrong-key" });
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct X-Api-Key", async () => {
    const res = await post("/bulk-update?sheet=Products", makeXlsxFormData(), { "X-Api-Key": API_KEY });
    expect(res.status).toBe(200);
  });
});

describe("POST /bulk-update — validation", () => {
  const authHeader = { "X-Api-Key": API_KEY };

  it("returns 400 when sheet param is missing", async () => {
    const res = await post("/bulk-update", makeXlsxFormData(), authHeader);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/sheet/i);
  });

  it("returns 400 when file field is missing", async () => {
    const res = await post("/bulk-update?sheet=Products", new FormData(), authHeader);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/file/i);
  });

  it("returns 404 for wrong path", async () => {
    const res = await worker.fetch(
      new Request("https://worker.example.com/other", { method: "POST" }),
      env as never,
      {} as never
    );
    expect(res.status).toBe(404);
  });

  it("returns 405 for non-POST", async () => {
    const res = await worker.fetch(
      new Request("https://worker.example.com/bulk-update?sheet=Products", { method: "GET", headers: { "X-Api-Key": API_KEY } }),
      env as never,
      {} as never
    );
    expect(res.status).toBe(405);
  });
});

describe("POST /bulk-update — response", () => {
  const authHeader = { "X-Api-Key": API_KEY };

  it("response always has Content-Type: application/json", async () => {
    const res = await post("/bulk-update?sheet=Products", makeXlsxFormData(), authHeader);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("returns Result Report shape on success", async () => {
    const res = await post("/bulk-update?sheet=Products", makeXlsxFormData(), authHeader);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ total: 1, succeeded: 1, failed: 0, skipped: 0, errors: [] });
  });

  it("passes dryRun=true to batch orchestrator", async () => {
    const { runBatch } = await import("./batch-orchestrator");
    await post("/bulk-update?sheet=Products&dryRun=true", makeXlsxFormData(), authHeader);
    expect(runBatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
  });

  it("passes dryRun=false when param absent", async () => {
    const { runBatch } = await import("./batch-orchestrator");
    await post("/bulk-update?sheet=Products", makeXlsxFormData(), authHeader);
    expect(runBatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), false);
  });
});

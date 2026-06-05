import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proxyToWorker } from "./proxy.server";

describe("proxyToWorker", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards request to WORKER_URL with X-Api-Key header set", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );

    const file = new Blob(["data"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await proxyToWorker({
      file,
      sheet: "Sheet1",
      dryRun: false,
      workerUrl: "https://worker.example.com/bulk-update",
      apiKey: "test-secret",
    });

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      "https://worker.example.com/bulk-update?sheet=Sheet1",
    );
    expect((calledInit.headers as Record<string, string>)["X-Api-Key"]).toBe(
      "test-secret",
    );
    expect(calledInit.method).toBe("POST");
  });

  it("sets dryRun=true query param when dryRun is true", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await proxyToWorker({
      file: new Blob(["data"]),
      sheet: "Data",
      dryRun: true,
      workerUrl: "https://worker.example.com/bulk-update",
      apiKey: "key",
    });

    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(new URL(calledUrl).searchParams.get("dryRun")).toBe("true");
  });

  it("returns worker 500 response unchanged to the caller", async () => {
    const mockFetch = vi.mocked(fetch);
    const errorBody = { error: "internal failure" };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(errorBody), { status: 500 }),
    );

    const response = await proxyToWorker({
      file: new Blob(["data"]),
      sheet: "Sheet1",
      dryRun: false,
      workerUrl: "https://worker.example.com/bulk-update",
      apiKey: "key",
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(errorBody);
  });
});

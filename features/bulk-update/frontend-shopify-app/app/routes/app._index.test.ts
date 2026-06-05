import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(),
  },
}));

import { action } from "./app._index";
import { authenticate } from "../shopify.server";

describe("action", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    process.env.WORKER_URL = "https://worker.example.com/bulk-update";
    process.env.API_KEY = "test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function makeRequest(): Request {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob(["data"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "test.xlsx",
    );
    fd.append("sheet", "Sheet1");
    fd.append("dryRun", "false");
    return new Request("http://localhost/app", { method: "POST", body: fd });
  }

  it("unauthenticated request does not reach the worker", async () => {
    vi.mocked(authenticate.admin).mockRejectedValue(
      new Response(null, { status: 302, headers: { Location: "/auth" } }),
    );

    await expect(
      action({ request: makeRequest(), params: {}, context: {} as any }),
    ).rejects.toBeInstanceOf(Response);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

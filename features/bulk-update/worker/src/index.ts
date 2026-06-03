import { parseExcel } from "./excel-parser";
import { ShopifyClient } from "./shopify-client";
import { runBatch } from "./batch-orchestrator";

export interface Env {
  SHOPIFY_ACCESS_TOKEN: string;
  SHOPIFY_STORE_DOMAIN: string;
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/bulk-update") return json({ error: "Not found" }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (request.headers.get("X-Api-Key") !== env.API_KEY) {
      return json({ error: "Unauthorized" }, 401);
    }

    const sheet = url.searchParams.get("sheet");
    if (!sheet) return json({ error: "Missing required query param: sheet" }, 400);

    const dryRun = url.searchParams.get("dryRun") === "true";

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return json({ error: "Invalid multipart/form-data body" }, 400);
    }

    const fileEntry = formData.get("file");
    if (!fileEntry || typeof fileEntry === "string") {
      return json({ error: "Missing required form field: file" }, 400);
    }
    const file: Blob = fileEntry;

    let rows;
    try {
      const buffer = await file.arrayBuffer();
      rows = parseExcel(buffer, sheet);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to parse Excel file";
      return json({ error: message }, 400);
    }

    try {
      const client = new ShopifyClient(env.SHOPIFY_STORE_DOMAIN, env.SHOPIFY_ACCESS_TOKEN);
      const report = await runBatch(rows, client, dryRun);
      return json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      return json({ error: message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface Env {
  SHOPIFY_ACCESS_TOKEN: string;
  SHOPIFY_STORE_DOMAIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/bulk-update") {
      return json({ error: "Not found" }, 404);
    }

    // Stub — business logic wired in later issues
    return json({ message: "ok", total: 0, succeeded: 0, failed: 0, errors: [] });
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

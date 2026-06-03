/**
 * Cloudflare Pages Function — proxy for the bulk-update worker.
 *
 * Forwards multipart/form-data POST requests to the worker URL, injecting
 * the X-Api-Key header server-side so the browser never sees it.
 *
 * Required Pages environment bindings:
 *   WORKER_URL  — full URL of the worker endpoint, e.g.
 *                 https://shopifyops-bulk-update.<account>.workers.dev/bulk-update
 *   API_KEY     — shared secret matching the worker's API_KEY secret
 */
export async function onRequestPost({ request, env }) {
  const workerUrl = env.WORKER_URL;
  const apiKey = env.API_KEY;

  if (!workerUrl || !apiKey) {
    return new Response(
      JSON.stringify({ error: "Server misconfiguration: WORKER_URL or API_KEY not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Forward query params (sheet, dryRun) to the worker URL.
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(workerUrl);
  for (const [key, value] of incomingUrl.searchParams.entries()) {
    targetUrl.searchParams.set(key, value);
  }

  // Clone the request, stripping the original host, and inject X-Api-Key.
  const proxyRequest = new Request(targetUrl.toString(), {
    method: "POST",
    headers: (() => {
      const h = new Headers(request.headers);
      h.set("X-Api-Key", apiKey);
      // Remove headers that must not be forwarded to the upstream.
      h.delete("host");
      h.delete("cf-connecting-ip");
      return h;
    })(),
    body: request.body,
    // Required so the body stream is forwarded correctly.
    duplex: "half",
  });

  let workerResponse;
  try {
    workerResponse = await fetch(proxyRequest);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach worker";
    return new Response(
      JSON.stringify({ error: `Proxy error: ${message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Return worker response to browser — preserve status and Content-Type.
  const contentType =
    workerResponse.headers.get("Content-Type") ?? "application/json";
  const body = await workerResponse.text();

  return new Response(body, {
    status: workerResponse.status,
    headers: { "Content-Type": contentType },
  });
}

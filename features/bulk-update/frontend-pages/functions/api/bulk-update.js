/**
 * Cloudflare Pages Function — proxy for the bulk-update worker.
 *
 * Forwards multipart/form-data POST requests to the worker URL, injecting
 * the X-Api-Key header server-side so the browser never sees it.
 *
 * Required Pages environment bindings:
 *   WORKER_URL  — full URL of the worker endpoint, including /bulk-update path, e.g.
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

  let targetUrl;
  try {
    targetUrl = new URL(workerUrl);
  } catch {
    return new Response(
      JSON.stringify({ error: "Server misconfiguration: WORKER_URL is not a valid URL" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Only forward the two known query params — prevent injection of arbitrary params.
  const incomingUrl = new URL(request.url);
  const sheet = incomingUrl.searchParams.get("sheet");
  const dryRun = incomingUrl.searchParams.get("dryRun");
  if (sheet !== null) targetUrl.searchParams.set("sheet", sheet);
  if (dryRun !== null) targetUrl.searchParams.set("dryRun", dryRun);

  // Build clean headers — only Content-Type (with multipart boundary) + X-Api-Key.
  // Never forward cookies, authorization, or CF client-identity headers to the upstream.
  const proxyHeaders = new Headers();
  const contentType = request.headers.get("Content-Type");
  if (contentType) proxyHeaders.set("Content-Type", contentType);
  proxyHeaders.set("X-Api-Key", apiKey);

  const proxyRequest = new Request(targetUrl.toString(), {
    method: "POST",
    headers: proxyHeaders,
    body: request.body,
    // Required so the body stream is forwarded correctly in CF Workers.
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

  // Stream body directly — avoid buffering the entire response into memory.
  const respContentType =
    workerResponse.headers.get("Content-Type") ?? "application/json";
  return new Response(workerResponse.body, {
    status: workerResponse.status,
    headers: { "Content-Type": respContentType },
  });
}

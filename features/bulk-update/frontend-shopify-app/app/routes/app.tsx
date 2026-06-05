import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch (error) {
    logAuthFailure(request, error);
    throw error;
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

function logAuthFailure(request: Request, error: unknown) {
  const status = error instanceof Response ? error.status : undefined;

  if (status !== 401) {
    return;
  }

  const url = new URL(request.url);
  const providedHmac = url.searchParams.get("hmac") || "";
  const timestamp = Number(url.searchParams.get("timestamp") || 0);
  const ageSeconds = timestamp ? Math.round(Date.now() / 1000 - timestamp) : null;
  const params = Array.from(url.searchParams.entries())
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right));
  const message = params.map(([key, value]) => `${key}=${value}`).join("&");
  const calculatedHmac = createHmac(
    "sha256",
    process.env.SHOPIFY_API_SECRET || "",
  )
    .update(message)
    .digest("hex");
  const hmacMatches =
    providedHmac.length === calculatedHmac.length &&
    timingSafeEqual(Buffer.from(providedHmac), Buffer.from(calculatedHmac));

  console.error("Shopify admin auth returned 401", {
    shop: url.searchParams.get("shop"),
    hostPresent: url.searchParams.has("host"),
    embedded: url.searchParams.get("embedded"),
    timestampAgeSeconds: ageSeconds,
    hmacPresent: Boolean(providedHmac),
    hmacMatches,
    apiKey: process.env.SHOPIFY_API_KEY,
    appUrl: process.env.SHOPIFY_APP_URL,
    scopes: process.env.SCOPES,
    secretFingerprint: process.env.SHOPIFY_API_SECRET
      ? createHash("sha256")
          .update(process.env.SHOPIFY_API_SECRET)
          .digest("hex")
          .slice(0, 12)
      : "missing",
  });
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/additional">Additional page</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

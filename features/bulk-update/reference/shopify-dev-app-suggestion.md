User question
I want to be able to load an excel file and develop an app that updates product info in bulk based on each row. could all this be develop inside shopify using react router or should it be hosted outside?


Shopify dev AI Assistant answer:
Before I dive into architecture options, one quick clarification so I can give you the correct install/setup steps: are you using any of these right now?

Claude Code
Cursor
VS Code / Visual Studio Code
Gemini CLI
If none of those, tell me what editor/IDE or environment you’re using. Once I know that, I’ll outline whether this tool should live fully inside a Shopify admin app (React + React Router), or partly outside Shopify, and how to handle the Excel upload and bulk product updates.You can absolutely build this entirely inside Shopify as an embedded app using React Router, and that’s usually the best approach. You’d use a React Router–based admin app with file upload, parse the spreadsheet on your backend, then call the GraphQL Admin API to update products in bulk (for example using the productSet mutation for bulk syncs).

Let me walk through:

When it makes sense to build it inside Shopify (React Router embedded app)
When you might instead host outside Shopify
A concrete high-level architecture for your Excel → bulk product updates app
I’ll assume “Excel file” means .xlsx or .csv exported from Excel.

1. “Inside Shopify” option: Embedded React Router app
For most merchant-facing tools like this, the recommended pattern is an embedded app that shows up directly inside the Shopify admin using the React Router app framework.

What this looks like
The merchant installs your app from the Apps section.
Your app appears as a page inside the Shopify admin, in the navigation.
Your front end is a React Router SPA that uses Polaris components and integrates with Shopify’s App Bridge.
You upload the Excel file via the app UI, send it to your own backend (Node/Express, Remix, etc.), parse it there, and then the backend calls the Admin GraphQL API to update products.
All of this is “inside Shopify” from the merchant’s point of view, but technically you still control the hosting (e.g. on a server or serverless platform). That’s just how Shopify apps work: the UI is embedded in admin via an iframe, but the app runtime is yours.

Why this is usually the right choice
Best merchant UX:
Merchant stays in Shopify admin. They click your app, upload Excel, see progress, etc.

Authentication is handled for you:
The Shopify React Router app framework + @shopify/shopify-app-remix / @shopify/shopify-app-express handle OAuth, session storage, and giving you an admin client you can use like:

typescript
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
   // Example from Shopify docs – calling the Admin GraphQL API in a React Router app
   import { ActionFunctionArgs } from "react-router";
   import { unauthenticated } from "../shopify.server";

   export async function action({ request }: ActionFunctionArgs) {
     const shop = getShopFromExternalRequest(request);
     const { admin } = await unauthenticated.admin(shop);

     const response = await admin.graphql(
       `#graphql
       mutation populateProduct($input: ProductInput!) {
         productCreate(input: $input) {
           product {
             id
           }
         }
       }`,
       {
         variables: {
           input: {
             title: "Product Name",
           },
         },
       }
     );

     const productData = await response.json();
     return { data: productData.data };
   }
Docs for unauthenticated.admin:
Unauthenticated Admin client in React Router apps

Security & scopes:

You request write_products (and possibly read_products) scopes.
All updates are done via the authenticated Admin API for the specific store.
Scalability & async work:

For large files, you can handle processing asynchronously (e.g. queue jobs) instead of blocking the HTTP request.
You can show progress in the admin UI and/or send notifications.
2. “Outside Shopify” option: External web app
You can build an app that lives completely outside Shopify (e.g., mybulktool.com) and still connects via the Admin API, but typically:

The merchant must authenticate with Shopify via OAuth.
You then store a long-lived access token and call the Admin GraphQL API from your external app.
The Excel upload and UI are just a regular web app.
This approach can make sense if:

You want this tool to work with multiple platforms (Shopify, plus others).
You don’t need it embedded in the admin and prefer a standalone product.
You have an existing SaaS where Shopify is just one integration.
But for a Shopify-focused bulk product update tool, embedded is usually superior.

3. Concrete architecture for your Excel bulk updater (embedded React Router app)
Here’s a suggested design using Shopify’s recommended patterns.

3.1. Frontend: React Router + Polaris inside Shopify admin
Docs:

Build a Shopify app using React Router
Shopify Polaris (admin UI components)
You’d create a route (e.g. /app) that:

Shows a file uploader (Excel/CSV) – e.g. Polaris DropZone.
Perhaps shows a preview / summary after upload (number of rows, columns).
Triggers an action that sends the file to your backend for processing.
Shows progress or results (e.g., “Updated 127 products, 3 failed”).
Rough flow in React Router:

loader to fetch status of past jobs.
action to accept the uploaded file.
3.2. Backend: Parse Excel and call Admin GraphQL API
Once the file hits your server:

Parse the spreadsheet

Use Node libraries like xlsx for .xlsx or fast-csv / papaparse for .csv (your choice; this part is not Shopify-specific).
Each row maps to:
A product handle / ID / SKU, etc.
Fields to update (title, description, price, inventory, metafields, etc.).
Map rows to Shopify product IDs
Depending on what’s in the spreadsheet:

If it contains product IDs (gid://shopify/Product/...): you’re ready to update.
If it has handles or SKUs, you may need to:
Query products via Admin GraphQL using products or productVariants connections.
Build a map: handle -> productId, sku -> variantId, etc.
Admin API docs entry point:
Shopify APIs: GraphQL Admin API

Bulk update logic

For straightforward updates, you can iterate rows and call:

productUpdate (per product)
or better, for sync-like behavior, productSet, which lets you update data “in one shot” per product.
Docs on updating product data:
Update product data with the GraphQL Admin API

If you’re updating a ton of products and pulling a lot of data first, you might also consider:

Bulk Operations API for large, asynchronous jobs.
Asynchronous processing (recommended)

For large Excel files, you don’t want to process everything in a single HTTP request:

User uploads file.
Your server:
Stores file (temp storage, S3, etc.).
Enqueues a “bulk update” job.
Returns a job ID.
Worker / background job:
Parses file.
For each row, calls Admin GraphQL mutation(s).
Frontend polls /jobs/:id or receives webhooks / SSE to show progress.
4. Should anything be hosted outside Shopify?
Even with an embedded app, you still host the code yourself. Shopify doesn’t run your backend; it embeds your frontend in the admin and delegates API access via OAuth and the Admin API.

So the real decision is:

Embedded frontend: Yes – build it using Shopify’s recommended React Router framework. This gives you:

Native admin integration.
Ready-made auth/session handling.
Polaris + App Bridge integration.
Backend location: Always “outside” (your own server or serverless), but tied tightly to your Shopify app.

There’s rarely a need to have a separate external UI in addition to the embedded one, unless you want:

A stand-alone non-embedded portal.
Multi-platform product editing (not just Shopify).
Some merchant experience that doesn’t make sense in the Shopify admin.
For your use case (“load Excel and bulk update product info by row”), an embedded app with its own backend is the ideal architecture.

5. How I’d structure the project end-to-end
Using the Shopify React Router app template:

Create a Shopify app using the React Router framework.
Docs: Build a Shopify app with React Router

Request the right scopes in your app configuration:

read_products
write_products
Possibly read_inventory / write_inventory or metafields scopes depending on what you’re updating.
Admin UI route /app:

Polaris Page + Card.
Polaris DropZone or similar component for file upload.
A submission Button that triggers a React Router action.
Action function for upload:

Receives FormData with the file.
Uses unauthenticated.admin(shop) or the authenticated admin client from the session to ensure you’re operating on the correct shop.
Stores the file and enqueues a background job.
Background job:

Parse spreadsheet into row objects.
For each row:
Resolve product/variant by handle/SKU or ID.
Prepare a ProductInput (or variant input or whatever you need).
Call admin.graphql(...) with the appropriate mutation.
Update job status (success, failures, logs).
Status UI:

Use a loader to fetch job status and show:
Progress bar
Result summary
Downloadable error report if some rows fail.
Next step: environment + toolkit
Once you answer which environment you’re in (Claude Code, Cursor, VS Code, Gemini CLI, or something else), I’ll:

Give you the exact Shopify CLI + plugin setup commands for your environment.
Then we can scaffold the app and I can help you:
Define the spreadsheet schema (which columns → which product fields).
Write example GraphQL mutations to apply updates per row.
Sketch or implement the React Router route for upload and job status.
If you already have a preference (embedded React app vs external), mention that too and I’ll tailor the next steps accordingly.

Sources
API: Admin GraphQL
GraphQL Admin API
Apps > Build > Product Merchandising > Products And Collections > Update Data
productSet mutation for bulk syncs
Apps > Build > Build?framework=reactRouter
React Router app framework
API: Shopify App React Router > Latest > Unauthenticated > Unauthenticated Admin
Unauthenticated Admin client in React Router apps
API: Polaris
Shopify Polaris (admin UI components)
API
Shopify APIs: GraphQL Admin API
Apps > Build > Product Merchandising > Products And Collections > Update Data
productSet
API: Admin GraphQL > Usage > Bulk Operations
Bulk Operations API

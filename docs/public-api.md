# DropRFID Public API Guide

This guide is for middleware, fulfillment jobs, data sync services, and other
server-side integrations that need to work with the Drop RFID stack.

The canonical API contract is [`../openapi/openapi.json`](../openapi/openapi.json).
Public endpoints are under `/public` and use organization-level API keys. App
endpoints such as `/routines` use Cognito JWTs instead.

## 1. Provide an API Key

Production integrations should receive an API key from a DropRFID admin or from
your organization's secret-management process.

For a local or self-hosted Drop RFID stack, create a high-entropy key value and
register that exact key, or the backend-required hash of it, with the target
organization in the API service:

```bash
export DROP_RFID_API_KEY="drfid_sk_live_$(openssl rand -hex 32)"
printf '%s\n' "$DROP_RFID_API_KEY"
```

Use the same value in your middleware environment. Never commit the generated
key to source control.

Recommended environment variables:

```bash
export DROP_RFID_API_BASE_URL="https://www.droprfid.com/api/v1"
export DROP_RFID_API_KEY="drfid_sk_live_replace_me"
```

For local development, point the base URL at your API server:

```bash
export DROP_RFID_API_BASE_URL="http://localhost:8080/api/v1"
```

Every public request sends the key as a bearer token:

```bash
Authorization: Bearer $DROP_RFID_API_KEY
```

## 2. Smoke Test the Connection

```bash
curl -sS "$DROP_RFID_API_BASE_URL/public/skus" \
  -H "Authorization: Bearer $DROP_RFID_API_KEY" \
  -H "Accept: application/json"
```

If the key is missing, invalid, or not registered for the organization, the API
returns `401`. Public API responses can return `429` when the key exceeds the
published rate limits: 60 requests per minute and 1000 requests per hour.

## 3. SKU Calls

Create a SKU with optional RFID bindings:

```bash
curl -sS "$DROP_RFID_API_BASE_URL/public/skus" \
  -X POST \
  -H "Authorization: Bearer $DROP_RFID_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sku_code": "TEE-BLK-M",
    "product_title": "Drop Logo Tee",
    "variant_label": "Black / M",
    "brand": "DropRFID",
    "color": "Black",
    "size": "M",
    "rfids": ["E2801191A5030060884F1234"]
  }'
```

List SKUs:

```bash
curl -sS "$DROP_RFID_API_BASE_URL/public/skus" \
  -H "Authorization: Bearer $DROP_RFID_API_KEY"
```

Fetch one SKU. Add `rfids_limit` and `rfids_offset` when you want a page of RFID
bindings instead of the full default array:

```bash
SKU_ID="replace-with-sku-uuid"

curl -sS "$DROP_RFID_API_BASE_URL/public/skus/$SKU_ID?rfids_limit=100&rfids_offset=0" \
  -H "Authorization: Bearer $DROP_RFID_API_KEY"
```

Partially update a SKU:

```bash
curl -sS "$DROP_RFID_API_BASE_URL/public/skus/$SKU_ID" \
  -X PATCH \
  -H "Authorization: Bearer $DROP_RFID_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product_title": "Drop Logo Tee - Updated"
  }'
```

## 4. Order Calls

Create an order from known SKU IDs:

```bash
SKU_ID="replace-with-sku-uuid"

curl -sS "$DROP_RFID_API_BASE_URL/public/orders" \
  -X POST \
  -H "Authorization: Bearer $DROP_RFID_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"order_number\": \"WEB-1001\",
    \"items\": [
      {\"sku_id\": \"$SKU_ID\", \"expected_quantity\": 2}
    ]
  }"
```

List orders, optionally by status:

```bash
curl -sS "$DROP_RFID_API_BASE_URL/public/orders?status=pending" \
  -H "Authorization: Bearer $DROP_RFID_API_KEY"
```

Update an order status:

```bash
ORDER_ID="replace-with-order-uuid"

curl -sS "$DROP_RFID_API_BASE_URL/public/orders/$ORDER_ID" \
  -X PATCH \
  -H "Authorization: Bearer $DROP_RFID_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'
```

## 5. Session and RFID Calls

List scan sessions:

```bash
curl -sS "$DROP_RFID_API_BASE_URL/public/sessions" \
  -H "Authorization: Bearer $DROP_RFID_API_KEY"
```

Fetch one session with device metadata and scanned RFID entries:

```bash
SESSION_ID="replace-with-session-uuid"

curl -sS "$DROP_RFID_API_BASE_URL/public/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $DROP_RFID_API_KEY"
```

Generate demo session data when that endpoint is enabled for your stack:

```bash
curl -sS "$DROP_RFID_API_BASE_URL/public/ai/generate-session" \
  -X POST \
  -H "Authorization: Bearer $DROP_RFID_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description":"Three black medium logo tees scanned at packing station 2."}'
```

## 6. GraphQL Endpoint

`POST /public/graphql` resolves reads — plus the `createSku`, `updateSku`, and
`createOrder` mutations — over the same data, scoped to the organization tied to
your API key. It is most useful when REST would need several round-trips. The
common case is reconciling a completed session: fetch its scanned tags already
joined to their SKUs alongside the order's expected quantities in one request.

```bash
curl -sS "$DROP_RFID_API_BASE_URL/public/graphql" \
  -X POST \
  -H "Authorization: Bearer $DROP_RFID_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query Reconcile($sessionId: ID!, $orderId: ID!) { session(id: $sessionId) { id status rfidCount rfids { epc sku { id skuCode productTitle } } } order(id: $orderId) { orderNumber status items { expectedQuantity sku { id skuCode } } } }",
    "variables": { "sessionId": "SESSION_UUID", "orderId": "ORDER_UUID" }
  }'
```

Field-level errors are returned in an `errors` array with a `200` status, as is
standard for GraphQL. The endpoint is published in
[`../openapi/openapi.json`](../openapi/openapi.json) as `operationId: publicGraphQL`.

## 7. Minimal Service Wrapper

Use one small HTTP wrapper in middleware so auth, JSON parsing, and rate-limit
handling are consistent:

```js
const baseUrl = process.env.DROP_RFID_API_BASE_URL ?? "https://www.droprfid.com/api/v1";
const apiKey = process.env.DROP_RFID_API_KEY;

if (!apiKey) {
  throw new Error("DROP_RFID_API_KEY is required");
}

async function dropRfid(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) {
    return null;
  }

  const body = await response.text();
  const data = body ? JSON.parse(body) : null;

  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    throw new Error(
      `DropRFID ${response.status}${retryAfter ? ` retry-after=${retryAfter}` : ""}: ${body}`,
    );
  }

  return data;
}

const skus = await dropRfid("/public/skus");
console.log(skus);
```

For a runnable version with common commands, see
[`../examples/node-public-api.mjs`](../examples/node-public-api.mjs).

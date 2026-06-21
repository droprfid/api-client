#!/usr/bin/env node

const baseUrl = (process.env.DROP_RFID_API_BASE_URL ?? "https://www.droprfid.com/api/v1")
  .replace(/\/$/, "");
const apiKey = process.env.DROP_RFID_API_KEY;

async function dropRfid(path, options = {}) {
  if (!apiKey) {
    throw new Error("DROP_RFID_API_KEY is required");
  }

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

  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(
      [
        `DropRFID ${response.status}`,
        retryAfter ? `retry-after=${retryAfter}` : null,
        rateLimitRemaining ? `remaining=${rateLimitRemaining}` : null,
        raw,
      ].filter(Boolean).join(" "),
    );
  }

  return data;
}

const api = {
  listSkus: () => dropRfid("/public/skus"),
  createSku: (sku) => dropRfid("/public/skus", {
    method: "POST",
    body: JSON.stringify(sku),
  }),
  getSku: (skuId, { rfidsLimit, rfidsOffset } = {}) => {
    const params = new URLSearchParams();
    if (rfidsLimit !== undefined) params.set("rfids_limit", String(rfidsLimit));
    if (rfidsOffset !== undefined) params.set("rfids_offset", String(rfidsOffset));
    const query = params.toString() ? `?${params}` : "";
    return dropRfid(`/public/skus/${skuId}${query}`);
  },
  updateSku: (skuId, patch) => dropRfid(`/public/skus/${skuId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  listOrders: (status) => dropRfid(`/public/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createOrder: (order) => dropRfid("/public/orders", {
    method: "POST",
    body: JSON.stringify(order),
  }),
  updateOrderStatus: (orderId, status) => dropRfid(`/public/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  }),
  listSessions: () => dropRfid("/public/sessions"),
  getSession: (sessionId) => dropRfid(`/public/sessions/${sessionId}`),
  generateSession: (description) => dropRfid("/public/ai/generate-session", {
    method: "POST",
    body: JSON.stringify({ description }),
  }),
  graphql: (query, variables) => dropRfid("/public/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  }),
};

const RECONCILE_QUERY = `query Reconcile($sessionId: ID!, $orderId: ID!) {
  session(id: $sessionId) { id status rfidCount rfids { epc sku { id skuCode productTitle } } }
  order(id: $orderId) { orderNumber status items { expectedQuantity sku { id skuCode } } }
}`;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for this command`);
  }
  return value;
}

function printUsage() {
  console.error(`Usage:
  DROP_RFID_API_KEY=... node examples/node-public-api.mjs list-skus
  DROP_RFID_API_KEY=... node examples/node-public-api.mjs create-sku
  DROP_RFID_API_KEY=... DROP_RFID_SKU_ID=... node examples/node-public-api.mjs get-sku
  DROP_RFID_API_KEY=... DROP_RFID_SKU_ID=... node examples/node-public-api.mjs create-order
  DROP_RFID_API_KEY=... node examples/node-public-api.mjs list-orders [status]
  DROP_RFID_API_KEY=... node examples/node-public-api.mjs list-sessions
  DROP_RFID_API_KEY=... DROP_RFID_SESSION_ID=... node examples/node-public-api.mjs get-session
  DROP_RFID_API_KEY=... node examples/node-public-api.mjs generate-session "description"
  DROP_RFID_API_KEY=... DROP_RFID_SESSION_ID=... DROP_RFID_ORDER_ID=... node examples/node-public-api.mjs reconcile
`);
}

async function main() {
  const [command, arg] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const sampleSku = {
    sku_code: `DEMO-${Date.now()}`,
    product_title: "DropRFID Demo Tee",
    variant_label: "Black / M",
    brand: "DropRFID",
    color: "Black",
    size: "M",
    rfids: [`E2801191${Date.now()}`],
  };

  const result = await ({
    "list-skus": () => api.listSkus(),
    "create-sku": () => api.createSku(sampleSku),
    "get-sku": () => api.getSku(requireEnv("DROP_RFID_SKU_ID"), {
      rfidsLimit: 100,
      rfidsOffset: 0,
    }),
    "update-sku": () => api.updateSku(requireEnv("DROP_RFID_SKU_ID"), {
      product_title: "DropRFID Demo Tee - Updated",
    }),
    "list-orders": () => api.listOrders(arg),
    "create-order": () => api.createOrder({
      order_number: `DEMO-${Date.now()}`,
      items: [
        {
          sku_id: requireEnv("DROP_RFID_SKU_ID"),
          expected_quantity: 1,
        },
      ],
    }),
    "update-order": () => api.updateOrderStatus(requireEnv("DROP_RFID_ORDER_ID"), arg ?? "in_progress"),
    "list-sessions": () => api.listSessions(),
    "get-session": () => api.getSession(requireEnv("DROP_RFID_SESSION_ID")),
    "generate-session": () => api.generateSession(arg ?? "One demo item scanned at station 1."),
    "reconcile": () => api.graphql(RECONCILE_QUERY, {
      sessionId: requireEnv("DROP_RFID_SESSION_ID"),
      orderId: requireEnv("DROP_RFID_ORDER_ID"),
    }),
  })[command]?.();

  if (result === undefined) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

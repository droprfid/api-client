#!/usr/bin/env node

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);
const webhookPath = process.env.DROP_RFID_WEBHOOK_PATH ?? "/webhooks/drop-rfid";
const webhookSecret = process.env.DROP_RFID_WEBHOOK_SECRET;
const allowInsecureWebhooks = process.env.DROP_RFID_ALLOW_INSECURE_WEBHOOKS === "true";
const fetchSessionDetails = process.env.DROP_RFID_FETCH_SESSION_DETAILS === "true";
const baseUrl = (process.env.DROP_RFID_API_BASE_URL ?? "https://www.droprfid.com/api/v1")
  .replace(/\/$/, "");
const apiKey = process.env.DROP_RFID_API_KEY;

const maxBodyBytes = 1024 * 1024;
const idempotencyTtlMs = 24 * 60 * 60 * 1000;
const seenEvents = new Map();

function printUsage() {
  console.error(`Usage:
  PORT=3000 \\
  DROP_RFID_WEBHOOK_SECRET=replace_with_shared_webhook_secret \\
  node examples/node-webhook-receiver.mjs

Optional:
  DROP_RFID_WEBHOOK_PATH=/webhooks/drop-rfid
  DROP_RFID_ALLOW_INSECURE_WEBHOOKS=true
  DROP_RFID_FETCH_SESSION_DETAILS=true
  DROP_RFID_API_BASE_URL=https://www.droprfid.com/api/v1
  DROP_RFID_API_KEY=drfid_sk_live_replace_me
`);
}

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function fixedTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyWebhook(request) {
  if (!webhookSecret) {
    return allowInsecureWebhooks;
  }

  // Placeholder: the exact Drop RFID signing scheme is not defined in this repo.
  // Replace this shared-secret header with the published signature verifier.
  const receivedSecret = request.headers["x-drop-rfid-webhook-secret"];
  return typeof receivedSecret === "string" && fixedTimeEqual(receivedSecret, webhookSecret);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function eventIdFrom(event, rawBody) {
  return event.id
    ?? event.event_id
    ?? event.eventId
    ?? event.delivery_id
    ?? event.deliveryId
    ?? `body_sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
}

function eventTypeFrom(event) {
  return event.event_type ?? event.eventType ?? event.type;
}

function rememberEvent(eventId) {
  const now = Date.now();

  for (const [seenEventId, expiresAt] of seenEvents) {
    if (expiresAt <= now) {
      seenEvents.delete(seenEventId);
    }
  }

  if (seenEvents.has(eventId)) {
    return false;
  }

  seenEvents.set(eventId, now + idempotencyTtlMs);
  return true;
}

async function dropRfid(path, options = {}) {
  if (!apiKey) {
    throw new Error("DROP_RFID_API_KEY is required for public API follow-up calls");
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
    throw new Error(
      `DropRFID ${response.status}${retryAfter ? ` retry-after=${retryAfter}` : ""}: ${raw}`,
    );
  }

  return data;
}

function sessionIdFrom(event) {
  return event.data?.session_id
    ?? event.data?.sessionId
    ?? event.session_id
    ?? event.sessionId;
}

async function maybeFetchSessionDetails(event) {
  const sessionId = sessionIdFrom(event);

  if (!fetchSessionDetails || !sessionId) {
    return;
  }

  const session = await dropRfid(`/public/sessions/${encodeURIComponent(sessionId)}`);
  console.log("Fetched session details", JSON.stringify({
    session_id: session.id ?? sessionId,
    status: session.status,
  }));
}

async function handleSessionCompleted(event) {
  await maybeFetchSessionDetails(event);
  console.log("Handled session.completed", JSON.stringify({
    session_id: sessionIdFrom(event),
    order_number: event.data?.order_number ?? event.data?.orderNumber,
  }));
}

async function handleRoutineCompleted(event) {
  await maybeFetchSessionDetails(event);
  console.log("Handled routine.completed", JSON.stringify({
    routine_id: event.data?.routine_id ?? event.data?.routineId,
    session_id: sessionIdFrom(event),
  }));
}

async function processEvent(event) {
  const eventType = eventTypeFrom(event);

  switch (eventType) {
    case "session.completed":
      await handleSessionCompleted(event);
      break;
    case "routine.completed":
      await handleRoutineCompleted(event);
      break;
    default:
      console.log("Received unhandled Drop RFID event", JSON.stringify({
        event_type: eventType,
        event_id: eventIdFrom(event, JSON.stringify(event)),
      }));
  }
}

async function handleWebhook(request, response) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (!verifyWebhook(request)) {
    jsonResponse(response, 401, { error: "invalid_webhook_secret" });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRequestBody(request);
  } catch (error) {
    jsonResponse(response, 413, { error: "payload_too_large", message: error.message });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    jsonResponse(response, 400, { error: "invalid_json" });
    return;
  }

  const eventType = eventTypeFrom(event);
  if (!eventType) {
    jsonResponse(response, 400, { error: "missing_event_type" });
    return;
  }

  const eventId = eventIdFrom(event, rawBody);
  if (!rememberEvent(eventId)) {
    jsonResponse(response, 200, { ok: true, duplicate: true, event_id: eventId });
    return;
  }

  jsonResponse(response, 202, { ok: true, event_id: eventId });

  setImmediate(() => {
    processEvent(event).catch((error) => {
      console.error("Drop RFID webhook processing failed", JSON.stringify({
        event_id: eventId,
        event_type: eventType,
        message: error.message,
      }));
    });
  });
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (!webhookSecret && !allowInsecureWebhooks) {
  console.error(
    "DROP_RFID_WEBHOOK_SECRET is required. Set DROP_RFID_ALLOW_INSECURE_WEBHOOKS=true only for local tests.",
  );
  process.exit(1);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    jsonResponse(response, 200, { ok: true });
    return;
  }

  if (url.pathname !== webhookPath) {
    jsonResponse(response, 404, { error: "not_found" });
    return;
  }

  handleWebhook(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) {
      jsonResponse(response, 500, { error: "internal_error" });
    }
  });
});

server.listen(port, () => {
  console.log(`Drop RFID webhook receiver listening on http://localhost:${port}${webhookPath}`);
});

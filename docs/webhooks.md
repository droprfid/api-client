# DropRFID Webhook Receiver Guide

This guide is for middleware services that receive Drop RFID webhook deliveries
from routine completion actions, then optionally call the public API with
`DROP_RFID_API_KEY`.

A Drop RFID **outbound target** of type `webhook` delivers a signed JSON `POST`
to a URL you control whenever a session attached to that target's routine
completes. The target's URL and signing secret are configured by a Drop RFID
admin (Integrations → outbound targets) and attached to a routine's completion
action — there is no public API to register targets.

## Receiver Contract

Expose a public HTTPS endpoint that accepts JSON:

```text
POST /webhooks/drop-rfid
Content-Type:       application/json
X-DRFID-Event-Type: session.completed
X-DRFID-Timestamp:  <unix-seconds>
X-DRFID-Signature:  t=<unix-seconds>,v1=<hex(hmac_sha256(secret, "<ts>." + rawBody))>
```

Recommended environment variables:

```bash
export PORT=3000
export DROP_RFID_WEBHOOK_SECRET="your_webhook_signing_secret"
export DROP_RFID_SIGNATURE_TOLERANCE_SECONDS=300

# Optional public API follow-up calls.
export DROP_RFID_API_BASE_URL="https://www.droprfid.com/api/v1"
export DROP_RFID_API_KEY="drfid_sk_live_replace_me"
export DROP_RFID_FETCH_SESSION_DETAILS=false
```

## Verifying the Signature

The signature is an HMAC-SHA256 over the exact raw request body, keyed by the
shared secret, so **verify before parsing JSON** and hash the bytes you received:

1. Read the raw request body as bytes — do not re-serialize parsed JSON.
2. Parse `X-DRFID-Signature` into its `t` (timestamp) and `v1` (hex digest) fields.
3. Reject if `t` is older than your tolerance (e.g. 300 s) to limit replay.
4. Compute `hmac_sha256(secret, t + "." + rawBody)` and compare to `v1` with a
   constant-time comparison.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(headerValue, rawBody, secret, toleranceSeconds = 300) {
  const fields = Object.fromEntries(
    String(headerValue).split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const { t, v1 } = fields;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex");
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

> The `X-DRFID-Event-Type` header is currently always `session.completed`. Treat
> the body's `event_type` field as authoritative (`session.completed` or
> `session.failed`).

## Event Shape

```json
{
  "schema_version": "1",
  "event_type": "session.completed",
  "event_id": "01JZ0000000000000000000000",
  "emitted_at": "2026-06-10T20:30:00.123456Z",
  "session": {
    "id": "00000000-0000-0000-0000-000000000000",
    "status": "completed",
    "revision": 3,
    "metadata": { "order_number": "WEB-1001" },
    "rfids": [
      { "rfid_code": "E2801191A5030060884F1234", "tid": "...", "scanned_at": "..." }
    ]
  }
}
```

`event_id` is stable per delivery and is the value to de-duplicate on. The
`session.metadata` object carries whatever the routine captured (for example an
order reference); use it to link the scan back to your system. The webhook body
is a point-in-time snapshot — for the authoritative current state, re-fetch with
`GET /public/sessions/{session_id}` (set `DROP_RFID_FETCH_SESSION_DETAILS=true`
in the example), or run a GraphQL reconciliation query (see
[`public-api.md`](public-api.md#6-graphql-endpoint)).

## Retry-Safe Behavior

Webhook senders retry on timeout or a non-2xx status. Make the receiver safe for
repeated deliveries:

- Return `401` for failed verification and `405` for the wrong method.
- Return `400` for invalid JSON or a missing event type.
- For a new valid event, record `event_id` before starting side effects.
- Return `202 Accepted` quickly, then do public API lookups, queue jobs, or
  update your system asynchronously.
- For an already-seen `event_id`, return `200 OK` and skip side effects.
- Store processed event IDs in Redis, a database table, or another durable store
  with a retention window longer than the Drop RFID retry window.

The sample keeps de-duplication in memory so it is runnable without dependencies.
That is fine for local development, but not enough for multiple instances,
restarts, or production retry safety.

## Run the Node Example

```bash
export PORT=3000
export DROP_RFID_WEBHOOK_SECRET="your_webhook_signing_secret"
node examples/node-webhook-receiver.mjs
```

Send a correctly signed sample event:

```bash
TS=$(date +%s)
BODY='{"schema_version":"1","event_type":"session.completed","event_id":"evt_demo_001","session":{"id":"00000000-0000-0000-0000-000000000000","metadata":{"order_number":"WEB-1001"}}}'
SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$DROP_RFID_WEBHOOK_SECRET" | sed 's/^.*= //')

curl -sS http://localhost:3000/webhooks/drop-rfid \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-DRFID-Timestamp: $TS" \
  -H "X-DRFID-Signature: t=$TS,v1=$SIG" \
  --data-binary "$BODY"
```

For local experimentation without a secret, set
`DROP_RFID_ALLOW_INSECURE_WEBHOOKS=true` to skip verification. Never do this in
production.

For outbound public API examples, see
[`../examples/node-public-api.mjs`](../examples/node-public-api.mjs) and
[`public-api.md`](public-api.md).

# DropRFID Webhook Receiver Guide

This guide is for middleware services that receive Drop RFID webhook-style
callbacks from routines or other server-side automation, then optionally call
the public API with `DROP_RFID_API_KEY`.

The current checked-in OpenAPI document describes routine actions with
`type: "webhook_event"` and a configurable `event_type`, but it does not define
a public webhook delivery endpoint, signing header, or fixed event-name enum.
Until your Drop RFID stack publishes an exact signing scheme, treat the shared
secret below as a placeholder contract between Drop RFID and your middleware.

## Receiver Contract

Expose a public HTTPS endpoint that accepts JSON:

```text
POST /webhooks/drop-rfid
Content-Type: application/json
X-Drop-RFID-Webhook-Secret: <shared secret placeholder>
```

Recommended environment variables:

```bash
export PORT=3000
export DROP_RFID_WEBHOOK_SECRET="replace_with_shared_webhook_secret"

# Optional public API follow-up calls.
export DROP_RFID_API_BASE_URL="https://www.droprfid.com/api/v1"
export DROP_RFID_API_KEY="drfid_sk_live_replace_me"
export DROP_RFID_FETCH_SESSION_DETAILS=false
```

When the production stack documents a real HMAC or asymmetric signature scheme,
replace the shared-secret comparison with that verifier and keep the rest of the
receiver behavior: verify before parsing side effects, de-duplicate by event ID,
send a fast 2xx response, and process follow-up work asynchronously.

## Event Shape

Event names are configured by the emitting routine action. A typical payload for
middleware can use this shape:

```json
{
  "id": "evt_01JZ0000000000000000000000",
  "event_type": "session.completed",
  "created_at": "2026-06-10T20:30:00Z",
  "data": {
    "session_id": "00000000-0000-0000-0000-000000000000",
    "routine_id": "00000000-0000-0000-0000-000000000000",
    "order_number": "WEB-1001"
  }
}
```

The example also accepts common aliases such as `event_id`, `eventId`, `type`,
and `delivery_id` so it can be adapted to local stacks. Production integrations
should require one stable event ID from the sender and store it durably.

## Retry-Safe Behavior

Webhook senders usually retry when a request times out or returns a non-2xx
status. Make the receiver safe for repeated deliveries:

- Return `401` for failed verification and `405` for the wrong method.
- Return `400` for invalid JSON or a missing event type.
- For a new valid event, record the event ID before starting side effects.
- Return `202 Accepted` quickly, then do public API lookups, queue jobs, or
  update your system asynchronously.
- For an already-seen event ID, return `200 OK` and skip side effects.
- Store processed event IDs in Redis, a database table, or another durable
  store with a retention window longer than the Drop RFID retry window.

The sample keeps de-duplication in memory so it is runnable without
dependencies. That is fine for local development, but not enough for multiple
instances, restarts, or production retry safety.

## Run the Node Example

```bash
export PORT=3000
export DROP_RFID_WEBHOOK_SECRET="replace_with_shared_webhook_secret"
node examples/node-webhook-receiver.mjs
```

Send a sample event:

```bash
curl -sS http://localhost:3000/webhooks/drop-rfid \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Drop-RFID-Webhook-Secret: $DROP_RFID_WEBHOOK_SECRET" \
  -d '{
    "id": "evt_demo_001",
    "event_type": "session.completed",
    "data": {
      "session_id": "00000000-0000-0000-0000-000000000000",
      "order_number": "WEB-1001"
    }
  }'
```

Enable optional public API enrichment:

```bash
export DROP_RFID_API_BASE_URL="https://www.droprfid.com/api/v1"
export DROP_RFID_API_KEY="drfid_sk_live_replace_me"
export DROP_RFID_FETCH_SESSION_DETAILS=true
node examples/node-webhook-receiver.mjs
```

For outbound public API examples, see
[`../examples/node-public-api.mjs`](../examples/node-public-api.mjs) and
[`public-api.md`](public-api.md).

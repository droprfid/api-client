# DropRFID API Client

Official generated API clients for DropRFID services.

This repository keeps the canonical checked-in OpenAPI document under
`openapi/openapi.json`. Language clients are generated from that document and
published from tagged releases.

## Public API quick start

Middleware and service integrations should call the public API with an
organization API key:

```bash
export DROP_RFID_API_BASE_URL="https://www.droprfid.com/api/v1"
export DROP_RFID_API_KEY="drfid_sk_live_replace_me"

curl -sS "$DROP_RFID_API_BASE_URL/public/skus" \
  -H "Authorization: Bearer $DROP_RFID_API_KEY" \
  -H "Accept: application/json"
```

For local or self-hosted Drop RFID stacks, generate a high-entropy key value and
register it with the organization in the API service before using it:

```bash
export DROP_RFID_API_KEY="drfid_sk_live_$(openssl rand -hex 32)"
```

Do not commit real API keys. Store them in your service secret manager or local
`.env` file, then pass them to API calls through environment variables.

See [docs/public-api.md](docs/public-api.md) for copy-paste cURL examples,
manual key guidance, endpoint notes, and response handling. Middleware that
receives Drop RFID routine/webhook callbacks should also review
[docs/webhooks.md](docs/webhooks.md). Dependency-free Node examples are
available at [examples/node-public-api.mjs](examples/node-public-api.mjs) and
[examples/node-webhook-receiver.mjs](examples/node-webhook-receiver.mjs).

## Refresh the OpenAPI spec

From a local `rfid` checkout:

```bash
./scripts/sync-openapi.sh --rfid-dir ../rfid
```

From the production API:

```bash
./scripts/sync-openapi.sh --source-url https://www.droprfid.com/api/v1/openapi.json
```

The GitHub Actions workflow in `.github/workflows/sync-openapi.yml` is a
manual fallback. The normal update path is the `moneypro/rfid` GitHub Action,
which regenerates this file from the `main` branch and commits here when the
public API contract changes.

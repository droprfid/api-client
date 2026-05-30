# DropRFID API Client

Official generated API clients for DropRFID services.

This repository keeps the canonical checked-in OpenAPI document under
`openapi/openapi.json`. Language clients are generated from that document and
published from tagged releases.

## Refresh the OpenAPI spec

From a local `rfid` checkout:

```bash
./scripts/sync-openapi.sh --rfid-dir ../rfid
```

From the production API:

```bash
./scripts/sync-openapi.sh --source-url https://www.droprfid.com/api/v1/openapi.json
```

The GitHub Actions workflow in `.github/workflows/sync-openapi.yml` refreshes
the checked-in spec from production and commits changes when the public API
contract changes.

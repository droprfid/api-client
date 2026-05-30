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

The GitHub Actions workflow in `.github/workflows/sync-openapi.yml` is a
manual fallback. The normal update path is the `moneypro/rfid` GitHub Action,
which regenerates this file from the `main` branch and commits here when the
public API contract changes.

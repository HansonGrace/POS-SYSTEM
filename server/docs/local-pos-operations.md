# Local POS Operations Guide

This guide documents the software-side implementation for:

- observability
- backups and recovery
- retail business workflows
- endpoint realism
- config hygiene

## Observability

### Structured logs

- All request logs are JSON (Pino) with UTC timestamps.
- `X-Request-Id` and `X-Correlation-Id` are attached to every request/response.
- Logs include request/actor context where available.
- Sensitive keys (`password`, `token`, `secret`, `authorization`, `cookie`, card data fields) are redacted before logging/auditing.

### Audit events

- Audit records are written to `AuditLog` through `emitSecurityEvent`.
- Event classification includes:
  - `severity`
  - `category`
  - `alertClass`
- Key events include auth, admin actions, order/transaction operations, register events, suspended sale lifecycle, and printer simulation.

### Runtime metrics

In-memory metrics are exposed via:

- `GET /api/admin/metrics`
- `GET /api/admin/observability`

Key metrics:

- `login_attempts_total`
- `login_failures_total`
- `transactions_created_total`
- `transactions_finalized_total`
- `refunds_issued_total`
- `payment_failures_total`
- `api_request_count`
- `api_error_count`
- `api_request_latency_ms`
- scanner/printer/register metrics

## Backups and Recovery

Logical backups export relational data + manifest metadata.

### What gets backed up

- users, catalog, customers, payment methods
- registers, register sessions, cash drawer events
- suspended sales
- order and transactional records
- audit logs

### Commands

From repo root:

```bash
npm run backup:create -- --out-dir ./server/backups --env-label local-drill
npm run backup:validate -- --file ./server/backups/<backup-file>.json
npm run backup:restore -- --file ./server/backups/<backup-file>.json --confirm
```

From `server/` workspace:

```bash
npm run backup:create -- --out-dir ./backups --env-label local-drill
npm run backup:restore -- --file ./backups/<backup-file>.json --confirm
npm run backup:validate -- --file ./backups/<backup-file>.json
```

Restore safety:

- restore validates manifest + table layout before applying
- restore requires explicit `--confirm` when `RESTORE_REQUIRE_CONFIRM=true`
- dry run is available via `--dry-run`

## Retail Business Workflows

### Registers, shifts, and drawer events

- `POST /api/register-sessions/open`
- `POST /api/register-sessions/:id/close`
- `POST /api/register-sessions/:id/drawer-events`
- `GET /api/register-sessions/current`

Shift behavior is modeled through `RegisterSession` lifecycle (`OPEN` -> `CLOSED`).
Cash drawer events are persisted in `CashDrawerEvent`.

### Suspended and resumed sales

- `POST /api/orders/suspended`
- `GET /api/orders/suspended`
- `POST /api/orders/suspended/:id/resume`
- resumed sales can be completed using `POST /api/orders` with `suspendedSaleId`

### Returns/refunds, receipts, taxes

- Returns and partial refunds remain supported in transactional endpoints.
- Order receipt data is exposed on `/api/orders/:id`.
- Tax is consistently applied with configured `TAX_RATE`.

## Endpoint Realism

### Cashier endpoint behavior

Cashier UI now supports:

- open/close shift controls
- scanner simulation (`/api/products/scan/:code`)
- suspend/resume sale list
- receipt printer simulation (`POST /api/orders/:id/print`)

### Kiosk-style constraints

- `KIOSK_MODE=true` enables lightweight key restrictions in cashier view to reduce accidental navigation refresh/back behavior during demos.

## Config Hygiene

Configuration is centrally loaded/validated in `server/src/config/index.js`.

### Required vs optional

- `SESSION_SECRET` remains required.
- Most local-operational settings have safe defaults.

### New standardized config keys

- `APP_ENV_LABEL`
- `OBSERVABILITY_ENABLED`
- `OBSERVABILITY_AUDIT_ENABLED`
- `OBSERVABILITY_METRICS_ENABLED`
- `KIOSK_MODE`
- `BACKUP_DIR`
- `BACKUP_ENV_LABEL`
- `RESTORE_REQUIRE_CONFIRM`

### Local profile behavior

- `APP_ENV_LABEL` defaults to `local`.
- `BACKUP_ENV_LABEL` falls back to `APP_ENV_LABEL` when omitted.
- startup warnings surface unsafe or disabled operational controls.

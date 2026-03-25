# POS application topology

## Stack detected
- Node.js + Express API in `server`
- Prisma ORM (`@prisma/client`) with SQLite/PostgreSQL migration scripts
- JavaScript tests via `node:test` and `supertest`

## Topology goals
- Keep a clear flow from request to response.
- Keep business logic out of route handlers.
- Keep Prisma access behind repository boundaries.

## Layer layout

- `presentation/http/` – HTTP adapters (Express routers)
  - `api.js`
  - `health.js`
- `application/` – orchestration and use-case flows
  - `flows/transactionFlow.js`
  - `flows/paymentFlow.js`
  - `container.js`
- `persistence/` – repository boundary and read models
  - `transactionRepository.js`
- `services/` – domain/business rule services
  - `transactionService.js`
  - `payment/paymentOrchestrator.js`
  - `core/*`

## Request flow example

`POST /api/transactions`

1. `presentation/http` route (`routes/transactionRoutes.js`) validates request.
2. Route calls `application/flows/transactionFlow.js`.
3. Flow delegates to domain service in `services/transactionService.js`.
4. Read/query consistency is preserved through `persistence/transactionRepository.js`.

## Maturity checklist for growth
- Move remaining routes to explicit `application/flows/*` usage.
- Add dedicated repositories for users/customers/registers/products/orders.
- Add domain packages under `application/` for receipts, pricing, taxes, discounts.

## Run commands
- Migrations: `npm run db:migrate` (from `server/`)
- Tests: `npm test` (from `server/`)

# WIP Open Source POS System

Work in progress. This repository is being cleaned up for open-source release.

## Current Technical Scope

- Monorepo with separate web client and API server
- `client/`: React + Vite + TypeScript single-page app
- `server/`: Node.js + Express REST API
- Data layer: Prisma ORM with SQLite default, optional PostgreSQL path
- Auth/session model: cookie-based sessions with role-aware route protection
- Ops/security primitives in progress: request context, audit logging, and configurable hardening controls

## Local Development (Current)

```bash
npm install
npm run db:reset
npm run dev
```

Default local endpoints:
- Client: `http://localhost:5173`
- API: `http://localhost:4000`

## Status

Documentation and public hardening are in progress. Interfaces, scripts, and config defaults may change.

# POS System Frontend (Mock UI)

Frontend-only POS simulation app using Vite + React + TypeScript.

## Setup

```bash
npm install
npm run dev
```

## Routes

- `/` -> redirects to `/login`
- `/login` -> cashier/employee login
- `/userinterface` -> protected blank user page (user session required)
- `/admin/login` -> admin login
- `/pos` -> redirects to `/userinterface`
- `/admin` -> protected admin panel page (admin session required)

## Admin Credentials

- Username: `admin`
- Password: `admin`

## Regular User Credentials

- `user1 / user1`
- `user2 / user2`
- ...
- `user10 / user10`

## Notes

- This is frontend-only.
- Authentication is mock auth stored in `localStorage` under `pos_session`.
- There is no backend, database, or API integration yet.

## Secure Node Auth Module

This repo also includes a backend-ready security module in `auth/` using Argon2id + pepper + lockout + migration.

```bash
npm run test:auth
```

See `auth/README.md` for API, config, schema, and security rationale.

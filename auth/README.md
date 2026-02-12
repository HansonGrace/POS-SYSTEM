# Secure Auth Module (Node.js)

This module provides secure password storage and authentication using Argon2id with per-user salt and server-side pepper.

## API

- `create_user(username, plaintext_password)`
- `verify_login(username, plaintext_password)`
- `change_password(username, old_password, new_password)`
- `issue_reset_token(username)` (helper)
- `reset_password(token, new_password)` (optional flow)
- `create_regular_users_1_to_10()` (creates `user1..user10` with matching passwords)

## Setup

```bash
npm install
npm run test:auth
npm run seed:users
```

## Config

- `PASSWORD_PEPPER` (required in production)
- `MIN_PASSWORD_LENGTH` (default: `12`)
- `MAX_FAILED_ATTEMPTS` (default: `5`)
- `LOCKOUT_MINUTES` (default: `15`)
- `ARGON2_PROFILE` (`baseline` or `high`)
- `ARGON2_MEMORY_KIB`
- `ARGON2_TIME_COST`
- `ARGON2_PARALLELISM`
- `ARGON2_HASH_LENGTH`

## Security Rationale

- Uses Argon2id and stores full encoded hash (algorithm, params, salt, digest).
- Uses a server-side pepper from env; pepper is never persisted in DB.
- Uses generic auth failures to reduce user enumeration risk.
- Implements account lockout after repeated failed attempts.
- Supports transparent migration from legacy `bcrypt` and `pbkdf2_sha256` on successful login.
- Enforces configurable minimum password length without arbitrary complexity rules.

Operational caveat:
- Rotating/changing `PASSWORD_PEPPER` invalidates existing passwords unless you support staged rehashing with old peppers.


CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(128) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_algo VARCHAR(32) NOT NULL CHECK (password_algo IN ('argon2id', 'bcrypt', 'pbkdf2_sha256')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);


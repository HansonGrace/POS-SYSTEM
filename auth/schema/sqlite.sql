CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL CHECK (password_algo IN ('argon2id', 'bcrypt', 'pbkdf2_sha256')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);


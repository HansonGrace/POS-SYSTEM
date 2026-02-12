function cloneRecord(user) {
  return user ? { ...user } : null;
}

export class InMemoryUserStore {
  constructor() {
    this.usersByUsername = new Map();
    this.usersById = new Map();
    this.nextId = 1;
  }

  async createUser(payload) {
    if (this.usersByUsername.has(payload.username)) {
      throw new Error("USERNAME_TAKEN");
    }

    const nowIso = new Date().toISOString();
    const record = {
      id: this.nextId++,
      username: payload.username,
      password_hash: payload.password_hash,
      password_algo: payload.password_algo,
      created_at: nowIso,
      updated_at: nowIso,
      last_login_at: null,
      failed_attempts: 0,
      locked_until: null,
      reset_token_hash: null,
      reset_token_expires_at: null
    };

    this.usersByUsername.set(record.username, record);
    this.usersById.set(record.id, record);
    return cloneRecord(record);
  }

  async findByUsername(username) {
    return cloneRecord(this.usersByUsername.get(username) ?? null);
  }

  async findById(id) {
    return cloneRecord(this.usersById.get(id) ?? null);
  }

  async findByResetTokenHash(tokenHash) {
    for (const record of this.usersById.values()) {
      if (record.reset_token_hash === tokenHash) {
        return cloneRecord(record);
      }
    }
    return null;
  }

  async updateUser(id, patch) {
    const current = this.usersById.get(id);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString()
    };

    this.usersById.set(id, updated);
    this.usersByUsername.set(updated.username, updated);
    return cloneRecord(updated);
  }

  async listUsers() {
    return [...this.usersById.values()]
      .sort((a, b) => a.id - b.id)
      .map((row) => ({ ...row }));
  }
}


import test from "node:test";
import assert from "node:assert/strict";
import { createAuthService, createLegacyHashForTests, InMemoryUserStore } from "../index.js";

function createService(options = {}) {
  return createAuthService({
    userStore: options.userStore ?? new InMemoryUserStore(),
    config: {
      pepper: options.pepper ?? "test-pepper",
      minPasswordLength: options.minPasswordLength ?? 8,
      maxFailedAttempts: options.maxFailedAttempts ?? 3,
      lockoutMinutes: options.lockoutMinutes ?? 15,
      argon2: {
        memoryCost: 16 * 1024,
        timeCost: 2,
        parallelism: 1,
        hashLength: 32
      }
    },
    logger: {
      info() {},
      warn() {}
    }
  });
}

test("create_user + verify_login work with Argon2id", async () => {
  const auth = createService();
  await auth.create_user("alice", "password123");

  const login = await auth.verify_login("alice", "password123");
  assert.equal(login.ok, true);
  assert.equal(login.user.username, "alice");
});

test("pepper change invalidates old hashes", async () => {
  const sharedStore = new InMemoryUserStore();
  const authA = createService({ userStore: sharedStore, pepper: "pepper-A" });
  await authA.create_user("bob", "password123");

  const authB = createService({ userStore: sharedStore, pepper: "pepper-B" });
  const login = await authB.verify_login("bob", "password123");
  assert.equal(login.ok, false);
});

test("lockout triggers after max failed attempts", async () => {
  const auth = createService({ maxFailedAttempts: 2 });
  await auth.create_user("charlie", "password123");

  const first = await auth.verify_login("charlie", "wrong-pass");
  const second = await auth.verify_login("charlie", "wrong-pass");
  const afterLock = await auth.verify_login("charlie", "password123");

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(afterLock.ok, false);
});

test("legacy bcrypt hash is upgraded to Argon2id on successful login", async () => {
  const store = new InMemoryUserStore();
  const pepper = "legacy-pepper";
  const auth = createService({ userStore: store, pepper });

  const legacyHash = await createLegacyHashForTests("bcrypt", "password123", pepper);
  const legacyUser = await store.createUser({
    username: "legacy-user",
    password_hash: legacyHash,
    password_algo: "bcrypt"
  });

  const before = await store.findById(legacyUser.id);
  assert.equal(before.password_algo, "bcrypt");

  const login = await auth.verify_login("legacy-user", "password123");
  assert.equal(login.ok, true);

  const after = await store.findById(legacyUser.id);
  assert.equal(after.password_algo, "argon2id");
  assert.match(after.password_hash, /^\$argon2id\$/);
});

test("legacy PBKDF2 hash is upgraded to Argon2id on successful login", async () => {
  const store = new InMemoryUserStore();
  const pepper = "legacy-pepper";
  const auth = createService({ userStore: store, pepper });

  const legacyHash = await createLegacyHashForTests("pbkdf2_sha256", "password123", pepper);
  const legacyUser = await store.createUser({
    username: "legacy-pbkdf2",
    password_hash: legacyHash,
    password_algo: "pbkdf2_sha256"
  });

  const login = await auth.verify_login("legacy-pbkdf2", "password123");
  assert.equal(login.ok, true);

  const after = await store.findById(legacyUser.id);
  assert.equal(after.password_algo, "argon2id");
  assert.match(after.password_hash, /^\$argon2id\$/);
});

import test from "node:test";
import assert from "node:assert/strict";

const baseConfigUrl = new URL("../src/config/index.js", import.meta.url).href;

async function withEnvironment(overrides, fn) {
  const keys = Object.keys(overrides);
  const previous = {};

  for (const key of keys) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

async function loadConfig() {
  const cacheBust = `${Date.now()}_${Math.random()}`;
  return import(`${baseConfigUrl}?test=${cacheBust}`);
}

test("startup fails when SESSION_SECRET is missing", async () => {
  await withEnvironment({ SESSION_SECRET: "", LAB_MODE: "false" }, async () => {
    await assert.rejects(loadConfig);
  });
});

test("startup fails when SESSION_SECRET is a known placeholder", async () => {
  await withEnvironment(
    {
      SESSION_SECRET: "lab-insecure-session-secret",
      LAB_MODE: "false",
      ALLOW_DEFAULT_SESSION_SECRET: "false"
    },
    async () => {
      await assert.rejects(loadConfig, /SESSION_SECRET appears to be a known default|too short/);
    }
  );
});

test("startup fails when SESSION_SECRET is too short", async () => {
  await withEnvironment({ SESSION_SECRET: "tiny", LAB_MODE: "false" }, async () => {
    await assert.rejects(loadConfig, /known default or too short/i);
  });
});

test("ALLOW_DEFAULT_SESSION_SECRET is only valid in LAB_MODE", async () => {
  await withEnvironment(
    {
      SESSION_SECRET: "lab-insecure-session-secret",
      LAB_MODE: "false",
      ALLOW_DEFAULT_SESSION_SECRET: "true"
    },
    async () => {
      await assert.rejects(loadConfig, /requires LAB_MODE=true/i);
    }
  );
});

test("startup allows placeholder secret only when explicit lab override is enabled", async () => {
  await withEnvironment(
    {
      SESSION_SECRET: "lab-insecure-session-secret",
      LAB_MODE: "true",
      ALLOW_DEFAULT_SESSION_SECRET: "true"
    },
    async () => {
      const { config } = await loadConfig();
      assert.equal(config.allowDefaultSessionSecret, true);
      assert.equal(config.sessionSecret, "lab-insecure-session-secret");
      assert.equal(config.labMode, true);
    }
  );
});

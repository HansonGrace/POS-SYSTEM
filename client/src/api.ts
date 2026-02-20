const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type RequestMethod = "GET" | "POST" | "PUT" | "DELETE";

type RequestOptions = {
  method?: RequestMethod;
  body?: unknown;
};

class ApiError extends Error {
  status: number;

  requestId: string | null;

  constructor(message: string, status: number, requestId: string | null) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

let csrfToken: string | null = null;
let csrfEnabled = true;
let csrfRequest: Promise<void> | null = null;

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function ensureCsrfToken() {
  if (!csrfEnabled || csrfToken) {
    return;
  }

  if (!csrfRequest) {
    csrfRequest = (async () => {
      const requestId = createRequestId();
      const response = await fetch(`${API_BASE}/api/auth/csrf`, {
        method: "GET",
        credentials: "include",
        headers: {
          "X-Request-Id": requestId
        }
      });

      if (!response.ok) {
        throw new Error("Failed to load CSRF token.");
      }

      const payload = (await response.json()) as { csrfToken: string; enabled: boolean };
      csrfEnabled = payload.enabled !== false;
      csrfToken = payload.csrfToken;
    })().finally(() => {
      csrfRequest = null;
    });
  }

  await csrfRequest;
}

function redirectToLogin() {
  if (window.location.pathname === "/login") {
    return;
  }

  const url = new URL(window.location.href);
  url.pathname = "/login";
  url.search = "?reason=session-expired";
  window.location.assign(url.toString());
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || "GET";
  const isStateChanging = !SAFE_METHODS.has(method);

  if (isStateChanging) {
    await ensureCsrfToken();
  }

  const requestId = createRequestId();
  const headers: Record<string, string> = {
    "X-Request-Id": requestId
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (isStateChanging && csrfEnabled && csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const responseRequestId = response.headers.get("x-request-id");
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (response.status === 401 && !path.startsWith("/api/auth/login")) {
    redirectToLogin();
  }

  if (!response.ok) {
    const message = payload?.message || `Request failed (${response.status}).`;
    throw new ApiError(message, response.status, responseRequestId);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" })
};

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function clearApiSessionState() {
  csrfToken = null;
}

export { ApiError };

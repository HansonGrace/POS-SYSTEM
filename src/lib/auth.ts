export type Session = {
  role: "user" | "admin";
  username: string;
};

const SESSION_KEY = "pos_session";
const REGULAR_USERS = new Set(
  Array.from({ length: 10 }, (_, index) => `user${index + 1}`)
);

function setSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loginUser(username: string, password: string): boolean {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedPassword = password.trim();

  if (!REGULAR_USERS.has(normalizedUsername)) {
    return false;
  }

  if (normalizedUsername !== normalizedPassword) {
    return false;
  }

  setSession({ role: "user", username: normalizedUsername });
  return true;
}

export function loginAdmin(username: string, password: string): boolean {
  if (username === "admin" && password === "admin") {
    setSession({ role: "admin", username });
    return true;
  }

  return false;
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Session;

    if (
      (parsed.role === "user" || parsed.role === "admin") &&
      typeof parsed.username === "string"
    ) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

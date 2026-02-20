import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, login, loading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const sessionMessage =
    searchParams.get("reason") === "session-expired"
      ? "Your session expired. Please sign in again."
      : "";

  useEffect(() => {
    if (!loading && user) {
      navigate(user.role === "ADMIN" ? "/admin" : "/pos", { replace: true });
    }
  }, [loading, user, navigate]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const loggedInUser = await login({ username, password, rememberMe });
      navigate(loggedInUser.role === "ADMIN" ? "/admin" : "/pos", { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <form className="panel login-card" onSubmit={onSubmit}>
        <h1>Point of Sale Login</h1>
        <p className="muted">
          Lab seed credentials are optional and only created when SEED_LAB_USERS=true.
        </p>
        {sessionMessage ? <div className="panel">{sessionMessage}</div> : null}

        {error ? <div className="error-box">{error}</div> : null}

        <label className="field-label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          required
        />

        <label className="field-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
          />
          Remember me for 7 days
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

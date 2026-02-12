import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loginAdmin } from "../lib/auth";

function LoginAdmin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loginAdmin(username, password)) {
      navigate("/admin", { replace: true });
      return;
    }

    setError("Invalid admin credentials.");
  };

  return (
    <div className="page-center">
      <form className="card" onSubmit={onSubmit}>
        <h1>Admin Login</h1>

        {error ? <div className="error">{error}</div> : null}

        <div className="form-group">
          <label htmlFor="admin-username">Username</label>
          <input
            id="admin-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button type="submit">Login</button>
        <p>
          Employee? <Link to="/login">Go to user login</Link>
        </p>
      </form>
    </div>
  );
}

export default LoginAdmin;

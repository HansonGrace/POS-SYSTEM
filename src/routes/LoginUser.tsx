import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loginUser } from "../lib/auth";

function LoginUser() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loginUser(username, password)) {
      navigate("/userinterface", { replace: true });
      return;
    }

    setError("Invalid user login. Use user1..user10 with matching password.");
  };

  return (
    <div className="page-center">
      <form className="card" onSubmit={onSubmit}>
        <h1>User Login</h1>

        {error ? <div className="error">{error}</div> : null}

        <div className="form-group">
          <label htmlFor="user-username">Username</label>
          <input
            id="user-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="user-password">Password</label>
          <input
            id="user-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button type="submit">Login</button>
        <p>Demo users: user1/user1 ... user10/user10</p>
        <p>
          Admin? <Link to="/admin/login">Go to admin login</Link>
        </p>
      </form>
    </div>
  );
}

export default LoginUser;

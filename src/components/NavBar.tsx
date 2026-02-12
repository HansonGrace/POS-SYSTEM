import { useNavigate } from "react-router-dom";
import { logout } from "../lib/auth";

function NavBar() {
  const navigate = useNavigate();

  const onLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="navbar">
      <strong>POS System</strong>
      <button type="button" onClick={onLogout}>
        Logout
      </button>
    </header>
  );
}

export default NavBar;

import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function TopNav({ title }: { title: string }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="top-nav">
      <div className="top-nav-left">
        <strong>RangePOS</strong>
        <span className="top-nav-title">{title}</span>
      </div>
      <div className="top-nav-right">
        <span>{user?.username}</span>
        <button type="button" onClick={onLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}

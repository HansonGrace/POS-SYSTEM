import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

type TopNavProps = {
  title: string;
  showSlogan?: boolean;
};

export default function TopNav({ title, showSlogan = false }: TopNavProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="top-nav">
      <div className="top-nav-left">
        {showSlogan ? (
          <img
            src="/images/TORCH_slogan_yellow.png"
            alt={`${title} logo`}
            className="top-nav-slogan-logo"
          />
        ) : null}
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

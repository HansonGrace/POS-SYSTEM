import { Outlet } from "react-router-dom";
import TopNav from "../components/TopNav";

export default function CashierLayout() {
  return (
    <div className="app-shell">
      <TopNav title="Cashier POS" />
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}

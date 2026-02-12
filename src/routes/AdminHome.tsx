import NavBar from "../components/NavBar";
import { getSession } from "../lib/auth";

function AdminHome() {
  const session = getSession();

  return (
    <>
      <NavBar />
      <main className="content">
        <h1>Admin Panel</h1>
        <p>Logged in as: {session?.username}</p>

        <div className="section-grid">
          <section className="section-box">Users</section>
          <section className="section-box">Transactions</section>
          <section className="section-box">System Settings</section>
        </div>
      </main>
    </>
  );
}

export default AdminHome;

import NavBar from "../components/NavBar";
import { getSession } from "../lib/auth";

function PosHome() {
  const session = getSession();

  return (
    <>
      <NavBar />
      <main className="content">
        <h1>POS Terminal</h1>
        <p>Logged in as: {session?.username}</p>

        <div className="placeholder-row">
          <button type="button">New Sale</button>
          <button type="button">Refund</button>
          <button type="button">End Shift</button>
        </div>
      </main>
    </>
  );
}

export default PosHome;

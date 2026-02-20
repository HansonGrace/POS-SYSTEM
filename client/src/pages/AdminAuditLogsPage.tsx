import { useEffect, useState } from "react";
import { api } from "../api";
import type { AuditLogRow, PaginatedResponse } from "../types";

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLogs = async (nextPage: number) => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<PaginatedResponse<AuditLogRow>>(
        `/api/admin/audit-logs?page=${nextPage}&size=25`
      );
      setLogs(response.items);
      setPage(response.page);
      setTotalPages(response.totalPages || 1);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs(1);
  }, []);

  return (
    <section className="panel">
      <div className="panel-header-row">
        <h2>Audit Log Viewer</h2>
        <div className="button-row">
          <button type="button" disabled={page <= 1} onClick={() => loadLogs(page - 1)}>
            Prev
          </button>
          <button type="button" disabled={page >= totalPages} onClick={() => loadLogs(page + 1)}>
            Next
          </button>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      {loading ? <div className="empty-state">Loading logs...</div> : null}

      {!loading && logs.length === 0 ? <div className="empty-state">No audit logs found.</div> : null}

      {!loading && logs.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Severity</th>
              <th>Category</th>
              <th>Action</th>
              <th>User</th>
              <th>IP</th>
              <th>Request ID</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.createdAt).toLocaleString()}</td>
                <td>{log.severity}</td>
                <td>{log.category}</td>
                <td>{log.action}</td>
                <td>{log.actor?.username || "system"}</td>
                <td>{log.ip || "n/a"}</td>
                <td>{log.requestId || "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

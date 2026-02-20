import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import type { PaginatedResponse, Role, UserRow } from "../types";

type CreateUserForm = {
  username: string;
  password: string;
  role: Role;
  active: boolean;
};

const initialCreateForm: CreateUserForm = {
  username: "",
  password: "",
  role: "CASHIER",
  active: true
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [createForm, setCreateForm] = useState<CreateUserForm>(initialCreateForm);
  const [resetPasswords, setResetPasswords] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadUsers = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await api.get<PaginatedResponse<UserRow>>("/api/users?size=100");
      setUsers(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    try {
      await api.post("/api/users", createForm);
      setCreateForm(initialCreateForm);
      await loadUsers();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create user.");
    }
  };

  const updateUser = async (userId: number, patch: Partial<UserRow>) => {
    setError("");

    try {
      await api.put(`/api/users/${userId}`, patch);
      await loadUsers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update user.");
    }
  };

  const resetPassword = async (userId: number) => {
    const password = resetPasswords[userId]?.trim();
    if (!password) {
      setError("Enter a new password before resetting.");
      return;
    }

    setError("");
    try {
      await api.post(`/api/users/${userId}/reset-password`, { password });
      setResetPasswords((current) => ({ ...current, [userId]: "" }));
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Failed to reset password.");
    }
  };

  return (
    <div className="admin-page-grid">
      <section className="panel">
        <h2>Create User</h2>

        {error ? <div className="error-box">{error}</div> : null}

        <form className="stacked-form" onSubmit={createUser}>
          <input
            placeholder="Username"
            value={createForm.username}
            onChange={(event) =>
              setCreateForm((prev) => ({ ...prev, username: event.target.value }))
            }
            required
          />
          <input
            placeholder="Password"
            type="password"
            value={createForm.password}
            onChange={(event) =>
              setCreateForm((prev) => ({ ...prev, password: event.target.value }))
            }
            required
          />
          <select
            value={createForm.role}
            onChange={(event) =>
              setCreateForm((prev) => ({ ...prev, role: event.target.value as Role }))
            }
          >
            <option value="CASHIER">CASHIER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={createForm.active}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, active: event.target.checked }))
              }
            />
            Active
          </label>

          <button type="submit">Create User</button>
        </form>
      </section>

      <section className="panel">
        <h2>User Management</h2>

        {loading ? (
          <div className="empty-state">Loading users...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Active</th>
                <th>Failed Logins</th>
                <th>Locked Until</th>
                <th>Password Reset</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>
                    <select
                      value={user.role}
                      onChange={(event) => updateUser(user.id, { role: event.target.value as Role })}
                    >
                      <option value="CASHIER">CASHIER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={user.active}
                      onChange={(event) => updateUser(user.id, { active: event.target.checked })}
                    />
                  </td>
                  <td>{user.failedLogins}</td>
                  <td>{user.lockedUntil ? new Date(user.lockedUntil).toLocaleString() : "n/a"}</td>
                  <td>
                    <input
                      type="password"
                      placeholder="New password"
                      value={resetPasswords[user.id] || ""}
                      onChange={(event) =>
                        setResetPasswords((prev) => ({ ...prev, [user.id]: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => resetPassword(user.id)}>
                      Reset Password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

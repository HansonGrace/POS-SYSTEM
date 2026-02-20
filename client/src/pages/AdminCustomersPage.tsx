import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import type { Customer, PaginatedResponse } from "../types";

type CustomerForm = {
  name: string;
  email: string;
  phone: string;
};

const emptyCustomerForm: CustomerForm = {
  name: "",
  email: "",
  phone: ""
};

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<CustomerForm>(emptyCustomerForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [cardInputs, setCardInputs] = useState<
    Record<number, { brand: string; last4: string; expMonth: string; expYear: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCustomers = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await api.get<PaginatedResponse<Customer>>("/api/customers?size=100");
      setCustomers(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load customers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const onSubmitCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const payload = {
      name: form.name,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null
    };

    try {
      if (editingId) {
        await api.put(`/api/customers/${editingId}`, payload);
      } else {
        await api.post("/api/customers", payload);
      }

      setForm(emptyCustomerForm);
      setEditingId(null);
      await loadCustomers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save customer.");
    }
  };

  const editCustomer = (customer: Customer) => {
    setEditingId(customer.id);
    setForm({
      name: customer.name,
      email: customer.email || "",
      phone: customer.phone || ""
    });
  };

  const addPaymentMethod = async (customerId: number) => {
    const input = cardInputs[customerId];
    if (!input || !input.last4 || !input.expMonth || !input.expYear || !input.brand) {
      setError("Complete card fields before saving.");
      return;
    }

    setError("");
    try {
      await api.post(`/api/customers/${customerId}/payment-methods`, {
        brand: input.brand,
        last4: input.last4,
        expMonth: Number(input.expMonth),
        expYear: Number(input.expYear)
      });

      setCardInputs((prev) => ({
        ...prev,
        [customerId]: { brand: "", last4: "", expMonth: "", expYear: "" }
      }));

      await loadCustomers();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Failed to save payment method.");
    }
  };

  return (
    <div className="admin-page-grid">
      <section className="panel">
        <h2>{editingId ? "Edit Customer" : "Create Customer"}</h2>

        {error ? <div className="error-box">{error}</div> : null}

        <form className="stacked-form" onSubmit={onSubmitCustomer}>
          <input
            placeholder="Name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
          <input
            placeholder="Email"
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
          />
          <input
            placeholder="Phone"
            value={form.phone}
            onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
          />

          <div className="button-row">
            <button type="submit">{editingId ? "Update" : "Create"}</button>
            {editingId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyCustomerForm);
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Customer Records</h2>

        {loading ? (
          <div className="empty-state">Loading customers...</div>
        ) : customers.length === 0 ? (
          <div className="empty-state">No customers created yet.</div>
        ) : (
          <div className="customer-list">
            {customers.map((customer) => {
              const paymentInput = cardInputs[customer.id] || {
                brand: "",
                last4: "",
                expMonth: "",
                expYear: ""
              };

              return (
                <article key={customer.id} className="customer-card">
                  <div className="panel-header-row">
                    <div>
                      <strong>{customer.name}</strong>
                      <p>{customer.email || "No email"}</p>
                      <p>{customer.phone || "No phone"}</p>
                    </div>
                    <button type="button" onClick={() => editCustomer(customer)}>
                      Edit
                    </button>
                  </div>

                  <h4>Payment Methods</h4>
                  {customer.paymentMethods && customer.paymentMethods.length > 0 ? (
                    <ul className="simple-list">
                      {customer.paymentMethods.map((method) => (
                        <li key={method.id}>
                          {method.brand} ****{method.last4} exp {method.expMonth}/{method.expYear}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-state">No saved cards.</div>
                  )}

                  <div className="payment-row">
                    <input
                      placeholder="Brand"
                      value={paymentInput.brand}
                      onChange={(event) =>
                        setCardInputs((prev) => ({
                          ...prev,
                          [customer.id]: { ...paymentInput, brand: event.target.value }
                        }))
                      }
                    />
                    <input
                      placeholder="Last4"
                      maxLength={4}
                      value={paymentInput.last4}
                      onChange={(event) =>
                        setCardInputs((prev) => ({
                          ...prev,
                          [customer.id]: {
                            ...paymentInput,
                            last4: event.target.value.replace(/\D/g, "")
                          }
                        }))
                      }
                    />
                    <input
                      placeholder="MM"
                      maxLength={2}
                      value={paymentInput.expMonth}
                      onChange={(event) =>
                        setCardInputs((prev) => ({
                          ...prev,
                          [customer.id]: {
                            ...paymentInput,
                            expMonth: event.target.value.replace(/\D/g, "")
                          }
                        }))
                      }
                    />
                    <input
                      placeholder="YYYY"
                      maxLength={4}
                      value={paymentInput.expYear}
                      onChange={(event) =>
                        setCardInputs((prev) => ({
                          ...prev,
                          [customer.id]: {
                            ...paymentInput,
                            expYear: event.target.value.replace(/\D/g, "")
                          }
                        }))
                      }
                    />
                    <button type="button" onClick={() => addPaymentMethod(customer.id)}>
                      Add Card Token
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

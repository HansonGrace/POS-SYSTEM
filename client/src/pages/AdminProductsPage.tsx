import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, formatCents } from "../api";
import type { PaginatedResponse, Product } from "../types";

type ProductForm = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  price: string;
  inventoryCount: string;
  active: boolean;
};

const emptyForm: ProductForm = {
  name: "",
  sku: "",
  barcode: "",
  category: "",
  price: "",
  inventoryCount: "0",
  active: true
};

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const loadProducts = async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set("q", search.trim());
      }

      const query = params.toString();
      const response = await api.get<PaginatedResponse<Product>>(
        `/api/products?size=100${query ? `&${query}` : ""}`
      );
      setProducts(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load products.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const onEdit = (product: Product) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode || "",
      category: product.category,
      price: (product.priceCents / 100).toFixed(2),
      inventoryCount: String(product.inventoryCount),
      active: product.active
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const payload = {
        name: form.name,
        sku: form.sku,
        barcode: form.barcode.trim() || null,
        category: form.category,
        priceCents: Math.round(Number(form.price) * 100),
        inventoryCount: Number(form.inventoryCount),
        active: form.active
      };

      if (editingId) {
        await api.put(`/api/products/${editingId}`, payload);
      } else {
        await api.post("/api/products", payload);
      }

      resetForm();
      await loadProducts();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const deactivate = async (id: number) => {
    if (!window.confirm("Deactivate this product?")) {
      return;
    }

    try {
      await api.delete(`/api/products/${id}`);
      await loadProducts();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to deactivate product.");
    }
  };

  const activeCount = useMemo(() => products.filter((product) => product.active).length, [products]);

  return (
    <div className="admin-page-grid">
      <section className="panel">
        <div className="panel-header-row">
          <h2>Products ({activeCount} active)</h2>
          <input
            placeholder="Search products"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        {loading ? (
          <div className="empty-state">Loading products...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Price</th>
                <th>Inventory</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.sku}</td>
                  <td>{product.category}</td>
                  <td>{formatCents(product.priceCents)}</td>
                  <td>{product.inventoryCount}</td>
                  <td>{product.active ? "Active" : "Inactive"}</td>
                  <td className="button-row">
                    <button type="button" onClick={() => onEdit(product)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => deactivate(product.id)}>
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>{editingId ? "Edit Product" : "Add Product"}</h2>

        <form className="stacked-form" onSubmit={onSubmit}>
          <input
            placeholder="Name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
          <input
            placeholder="SKU"
            value={form.sku}
            onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value }))}
            required
          />
          <input
            placeholder="Barcode"
            value={form.barcode}
            onChange={(event) => setForm((prev) => ({ ...prev, barcode: event.target.value }))}
          />
          <input
            placeholder="Category"
            value={form.category}
            onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
            required
          />
          <input
            placeholder="Price"
            type="number"
            step="0.01"
            min="0"
            value={form.price}
            onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
            required
          />
          <input
            placeholder="Inventory"
            type="number"
            min="0"
            value={form.inventoryCount}
            onChange={(event) => setForm((prev) => ({ ...prev, inventoryCount: event.target.value }))}
            required
          />

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
            />
            Active
          </label>

          <div className="button-row">
            <button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : editingId ? "Update Product" : "Create Product"}
            </button>
            {editingId ? (
              <button type="button" onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}

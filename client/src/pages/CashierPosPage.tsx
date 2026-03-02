import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatCents } from "../api";
import type { Customer, Order, PaginatedResponse, Product } from "../types";

type CartLine = {
  product: Product;
  quantity: number;
  modifiers?: string[];
};

export default function CashierPosPage() {
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [taxRate, setTaxRate] = useState(0.0825);
  const [search, setSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [cart, setCart] = useState<Record<number, CartLine>>({});
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [error, setError] = useState("");

  const [paymentType, setPaymentType] = useState<"CASH" | "CARD">("CASH");
  const [customerId, setCustomerId] = useState<string>("");
  const [saveCardOnFile, setSaveCardOnFile] = useState(false);
  const [cardBrand, setCardBrand] = useState("VISA");
  const [cardLast4, setCardLast4] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");

  const loadProducts = async () => {
    setLoadingProducts(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("active", "true");
      if (search.trim()) {
        params.set("q", search.trim());
      }
      if (categoryFilter !== "ALL") {
        params.set("category", categoryFilter);
      }

      const query = params.toString();
      const response = await api.get<PaginatedResponse<Product>>(
        `/api/products?size=100${query ? `&${query}` : ""}`
      );
      setProducts(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load products.");
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryFilter]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const loadCustomers = async () => {
    try {
      const params = new URLSearchParams();
      if (customerSearch.trim()) {
        params.set("q", customerSearch.trim());
      }
      params.set("size", "25");

      const response = await api.get<PaginatedResponse<Customer>>(
        `/api/customers/search?${params.toString()}`
      );
      setCustomers(response.items);
    } catch {
      setCustomers([]);
    }
  };

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const configResponse = await api.get<{ taxRate: number }>("/api/config");
        setTaxRate(configResponse.taxRate);
      } catch {
        // Keep defaults for resilient cashier flow.
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSearch]);

  const categories = useMemo(() => {
    const values = new Set(products.map((product) => product.category));
    return ["ALL", ...Array.from(values).sort()];
  }, [products]);

  const cartLines = useMemo(() => Object.values(cart), [cart]);
  const selectedCustomer = useMemo(
    () => customers.find((customer) => String(customer.id) === customerId) || null,
    [customers, customerId]
  );

  const subtotalCents = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0),
    [cartLines]
  );
  const taxCents = Math.round(subtotalCents * taxRate);
  const totalCents = subtotalCents + taxCents;
  const totalItems = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.quantity, 0),
    [cartLines]
  );

  const addToCart = (product: Product) => {
    let atStockLimit = false;

    setCart((current) => {
      const existing = current[product.id];
      const nextQuantity = existing ? existing.quantity + 1 : 1;
      if (nextQuantity > product.inventoryCount) {
        atStockLimit = true;
        return current;
      }

      return {
        ...current,
        [product.id]: {
          product,
          quantity: nextQuantity,
          modifiers: existing?.modifiers || []
        }
      };
    });

    if (atStockLimit) {
      setError(`Cannot add more ${product.name}. In-stock limit reached.`);
      return;
    }

    setError("");
  };

  const updateQuantity = (productId: number, quantity: number) => {
    setCart((current) => {
      const existing = current[productId];
      if (!existing) {
        return current;
      }

      if (quantity <= 0) {
        const clone = { ...current };
        delete clone[productId];
        return clone;
      }

      const boundedQty = Math.min(quantity, existing.product.inventoryCount);
      return {
        ...current,
        [productId]: {
          ...existing,
          quantity: boundedQty
        }
      };
    });
  };

  const changeQuantity = (productId: number, delta: number) => {
    const existing = cart[productId];
    if (!existing) {
      return;
    }

    const nextQty = Math.max(1, Math.min(existing.quantity + delta, existing.product.inventoryCount));
    updateQuantity(productId, nextQty);
  };

  const removeFromCart = (productId: number) => {
    setCart((current) => {
      const clone = { ...current };
      delete clone[productId];
      return clone;
    });
  };

  const confirmRemoveFromCart = (line: CartLine) => {
    const hasModifiers = Boolean(line.modifiers?.length);
    const needsConfirmation = line.quantity > 1 || hasModifiers;

    if (
      needsConfirmation &&
      !window.confirm("Remove this cart line? Quantity or modifiers will be discarded.")
    ) {
      return;
    }

    removeFromCart(line.product.id);
  };

  const resetCheckoutFields = () => {
    setPaymentType("CASH");
    setCustomerId("");
    setSaveCardOnFile(false);
    setCardBrand("VISA");
    setCardLast4("");
    setExpMonth("");
    setExpYear("");
  };

  const checkout = async () => {
    if (cartLines.length === 0) {
      setError("Cart is empty.");
      return;
    }

    if (paymentType === "CARD" && saveCardOnFile) {
      if (!customerId || !cardLast4 || !expMonth || !expYear) {
        setError("Customer and card details are required to save card on file.");
        return;
      }
    }

    setCheckoutBusy(true);
    setError("");

    try {
      const payload: Record<string, unknown> = {
        paymentType,
        customerId: customerId ? Number(customerId) : null,
        items: cartLines.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity
        })),
        saveCardOnFile
      };

      if (paymentType === "CARD" && saveCardOnFile) {
        payload.card = {
          brand: cardBrand,
          last4: cardLast4,
          expMonth: Number(expMonth),
          expYear: Number(expYear)
        };
      }

      const response = await api.post<{ order: Order }>("/api/orders", payload);
      setCart({});
      resetCheckoutFields();
      setCheckoutOpen(false);
      navigate(`/pos/receipt/${response.order.id}`);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Checkout failed.");
    } finally {
      setCheckoutBusy(false);
    }
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    const query = search.trim();
    if (!query) {
      return;
    }

    void (async () => {
      try {
        const params = new URLSearchParams();
        params.set("active", "true");
        params.set("q", query);
        params.set("size", "25");
        if (categoryFilter !== "ALL") {
          params.set("category", categoryFilter);
        }

        const response = await api.get<PaginatedResponse<Product>>(`/api/products?${params.toString()}`);
        const firstMatch = response.items.find((product) => product.inventoryCount > 0);
        if (!firstMatch) {
          setError("No in-stock product matched your search.");
          return;
        }

        setProducts(response.items);
        addToCart(firstMatch);
        setSearch("");
      } catch (quickAddError) {
        setError(quickAddError instanceof Error ? quickAddError.message : "Quick add failed.");
      }
    })();
  };

  const openCheckout = () => {
    if (!cartLines.length) {
      setError("Cart is empty.");
      return;
    }

    setError("");
    setCheckoutOpen(true);
  };

  return (
    <div className="cashier-layout register-layout">
      <section className="panel product-panel">
        <div className="panel-header-row register-header">
          <h2>Register</h2>
          <span className="muted">Search / Scan</span>
        </div>

        <div className="toolbar-row register-toolbar">
          <input
            ref={searchInputRef}
            placeholder="Search by name, SKU, or barcode"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={onSearchKeyDown}
            aria-label="Search or scan product"
          />
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <p className="muted search-hint">Hint: scan barcode and press Enter to add the first match.</p>

        {loadingProducts ? <div className="empty-state">Loading products...</div> : null}

        {!loadingProducts && products.length === 0 ? (
          <div className="empty-state">No products match the current filter.</div>
        ) : null}

        <div className="product-grid">
          {products.map((product) => (
            <article key={product.id} className="product-card">
              <h3>{product.name}</h3>
              <p>{product.category}</p>
              <p>SKU: {product.sku}</p>
              <p>In stock: {product.inventoryCount}</p>
              <div className="product-card-footer">
                <strong>{formatCents(product.priceCents)}</strong>
                <button
                  type="button"
                  onClick={() => addToCart(product)}
                  disabled={product.inventoryCount === 0}
                >
                  Add
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel cart-panel">
        <div className="panel-header-row">
          <h2>Cart</h2>
          <span className="muted">{totalItems} item(s)</span>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        {cartLines.length === 0 ? <div className="empty-state">No items in cart.</div> : null}

        {cartLines.length > 0 ? (
          <div className="cart-lines">
            {cartLines.map((line) => (
              <div key={line.product.id} className="cart-line">
                <div className="cart-line-main">
                  <strong>{line.product.name}</strong>
                  <p>{line.product.sku}</p>
                </div>

                <div className="cart-line-actions">
                  <div className="qty-controls" aria-label={`Quantity controls for ${line.product.name}`}>
                    <button
                      type="button"
                      onClick={() => changeQuantity(line.product.id, -1)}
                      disabled={line.quantity <= 1}
                    >
                      -
                    </button>
                    <span className="qty-value">{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => changeQuantity(line.product.id, 1)}
                      disabled={line.quantity >= line.product.inventoryCount}
                    >
                      +
                    </button>
                  </div>
                  <strong>{formatCents(line.product.priceCents * line.quantity)}</strong>
                  <button type="button" className="button-quiet" onClick={() => confirmRemoveFromCart(line)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="totals-box">
          <div>
            <span>Subtotal</span>
            <strong>{formatCents(subtotalCents)}</strong>
          </div>
          <div>
            <span>Tax</span>
            <strong>{formatCents(taxCents)}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{formatCents(totalCents)}</strong>
          </div>
        </div>

        <div className="checkout-block">
          <button
            type="button"
            className="checkout-trigger"
            onClick={openCheckout}
            disabled={checkoutBusy || cartLines.length === 0}
          >
            Checkout
          </button>
        </div>
      </section>

      {checkoutOpen ? (
        <div className="checkout-modal-overlay" role="presentation" onClick={() => setCheckoutOpen(false)}>
          <section
            className="panel checkout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header-row">
              <h3 id="checkout-title">Checkout</h3>
            </div>

            <label className="field-label" htmlFor="customer-id">
              Customer
            </label>
            <input
              placeholder="Search customer by name/email/phone"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
            />
            <select
              id="customer-id"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Walk-in</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>

            <label className="field-label" htmlFor="payment-type">
              Payment Method
            </label>
            <select
              id="payment-type"
              value={paymentType}
              onChange={(event) => setPaymentType(event.target.value as "CASH" | "CARD")}
            >
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
            </select>

            {selectedCustomer?.paymentMethods?.length ? (
              <div className="empty-state">
                Stored cards:{" "}
                {selectedCustomer.paymentMethods
                  .map((card) => `${card.brand} ****${card.last4} (${card.expMonth}/${card.expYear})`)
                  .join(", ")}
              </div>
            ) : null}

            {paymentType === "CARD" ? (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={saveCardOnFile}
                    onChange={(event) => setSaveCardOnFile(event.target.checked)}
                  />
                  Save card on file
                </label>

                {saveCardOnFile ? (
                  <div className="card-form-grid">
                    <input
                      placeholder="Brand (e.g. VISA)"
                      value={cardBrand}
                      onChange={(event) => setCardBrand(event.target.value)}
                    />
                    <input
                      placeholder="Last 4"
                      maxLength={4}
                      value={cardLast4}
                      onChange={(event) => setCardLast4(event.target.value.replace(/\D/g, ""))}
                    />
                    <input
                      placeholder="Exp Month"
                      value={expMonth}
                      onChange={(event) => setExpMonth(event.target.value.replace(/\D/g, ""))}
                    />
                    <input
                      placeholder="Exp Year"
                      value={expYear}
                      onChange={(event) => setExpYear(event.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="totals-box checkout-summary">
              <div>
                <span>Subtotal</span>
                <strong>{formatCents(subtotalCents)}</strong>
              </div>
              <div>
                <span>Tax</span>
                <strong>{formatCents(taxCents)}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{formatCents(totalCents)}</strong>
              </div>
            </div>

            <div className="button-row checkout-actions">
              <button type="button" onClick={() => setCheckoutOpen(false)} disabled={checkoutBusy}>
                Cancel
              </button>
              <button type="button" onClick={checkout} disabled={checkoutBusy || cartLines.length === 0}>
                {checkoutBusy ? "Processing..." : "Complete Sale"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

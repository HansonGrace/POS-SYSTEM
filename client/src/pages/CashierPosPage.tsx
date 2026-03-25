import { KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatCents } from "../api";
import type {
  Customer,
  Order,
  PaginatedResponse,
  Product,
  RegisterSession,
  SuspendedSale
} from "../types";

const PRODUCT_IMAGE_BY_SKU: Record<string, string> = {
  "GRC-1001": "wholemilk.png",
  "GRC-1002": "browneggs.png",
  "GRC-1003": "whitebread.png",
  "GRC-1004": "peanutbutter.png",
  "GRC-1005": "jasminerice.png",
  "GRC-1006": "oliveoil.png",
  "BEV-2001": "colacan.png",
  "BEV-2002": "orangejuice.png",
  "BEV-2003": "sparklinglimewater.png",
  "BEV-2004": "icedcoffeebottle.png",
  "BEV-2005": "greentea.png",
  "BEV-2006": "energydrink.png",
  "SNK-3001": "seasaltchips.png",
  "SNK-3002": "trailmix.png",
  "SNK-3003": "chocolatebar.png",
  "SNK-3004": "proteinbar.png",
  "SNK-3005": "pretzelsticks.png",
  "SNK-3006": "popcornbutter.png",
  "HSE-4001": "papertowels (2).png",
  "HSE-4002": "dishsoap.png",
  "HSE-4003": "laundrydetergentpng.png",
  "HSE-4004": "trashbags.png",
  "HSE-4005": "allpurposecleaner.png",
  "HSE-4006": "toiletpaper.png",
  "PRD-5001": "banana.png",
  "PRD-5002": "galaapples.png",
  "PRD-5003": "tomatoes.png",
  "PRD-5004": "avacado.png",
  "PRD-5005": "bellpeppers.png",
  "PRD-5006": "carrots.png"
};

function getProductImageSrc(product: Product): string | null {
  const fileName = PRODUCT_IMAGE_BY_SKU[product.sku];
  return fileName ? encodeURI(`/images/${fileName}`) : null;
}

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
  const [kioskMode, setKioskMode] = useState(true);
  const [registerSession, setRegisterSession] = useState<RegisterSession | null>(null);
  const [registerIdInput, setRegisterIdInput] = useState("1");
  const [openingFloatInput, setOpeningFloatInput] = useState("0");
  const [registerBusy, setRegisterBusy] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [suspendedSales, setSuspendedSales] = useState<SuspendedSale[]>([]);
  const [resumedSaleId, setResumedSaleId] = useState<number | null>(null);

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

  const loadCurrentRegisterSession = async () => {
    try {
      const response = await api.get<{ session: RegisterSession | null }>("/api/register-sessions/current");
      setRegisterSession(response.session);
      return response.session;
    } catch {
      setRegisterSession(null);
      return null;
    }
  };

  const loadSuspendedSales = async () => {
    try {
      const response = await api.get<{ items: SuspendedSale[] }>("/api/orders/suspended");
      setSuspendedSales(response.items);
    } catch {
      setSuspendedSales([]);
    }
  };

  const openRegisterSession = async () => {
    const registerId = Number(registerIdInput);
    if (!Number.isInteger(registerId) || registerId <= 0) {
      setError("Register id must be a positive number.");
      return;
    }

    setRegisterBusy(true);
    setError("");
    try {
      const startingBalanceCents = Math.round(Number(openingFloatInput || 0) * 100);
      const response = await api.post<{ session: RegisterSession }>("/api/register-sessions/open", {
        registerId,
        startingBalanceCents
      });
      setRegisterSession(response.session);
      await loadSuspendedSales();
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "Failed to open register session.");
    } finally {
      setRegisterBusy(false);
    }
  };

  const closeRegisterSession = async () => {
    if (!registerSession) {
      setError("No open register session.");
      return;
    }

    setRegisterBusy(true);
    setError("");
    try {
      await api.post<{ session: RegisterSession }>(`/api/register-sessions/${registerSession.id}/close`, {});
      setRegisterSession(null);
      setSuspendedSales([]);
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "Failed to close register session.");
    } finally {
      setRegisterBusy(false);
    }
  };

  const recordNoSaleDrawerEvent = async () => {
    if (!registerSession) {
      setError("Open a register session before drawer events.");
      return;
    }

    setRegisterBusy(true);
    setError("");
    try {
      await api.post(`/api/register-sessions/${registerSession.id}/drawer-events`, {
        type: "NO_SALE",
        amountCents: 0,
        reason: "cashier initiated drawer open"
      });
    } catch (drawerError) {
      setError(drawerError instanceof Error ? drawerError.message : "Failed to record drawer event.");
    } finally {
      setRegisterBusy(false);
    }
  };

  const simulateScan = async () => {
    const code = scanCode.trim();
    if (!code) {
      return;
    }

    setScanBusy(true);
    setError("");
    try {
      const response = await api.get<{ product: Product }>(`/api/products/scan/${encodeURIComponent(code)}`);
      addToCart(response.product);
      setScanCode("");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Scanner simulation failed.");
    } finally {
      setScanBusy(false);
    }
  };

  const suspendCurrentSale = async () => {
    if (cartLines.length === 0) {
      setError("Cart is empty.");
      return;
    }
    if (!registerSession) {
      setError("Open a register session before suspending a sale.");
      return;
    }

    setCheckoutBusy(true);
    setError("");
    try {
      await api.post<{ suspendedSale: SuspendedSale }>("/api/orders/suspended", {
        registerSessionId: registerSession.id,
        customerId: customerId ? Number(customerId) : null,
        items: cartLines.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity
        }))
      });
      setCart({});
      setResumedSaleId(null);
      resetCheckoutFields();
      await loadSuspendedSales();
    } catch (suspendError) {
      setError(suspendError instanceof Error ? suspendError.message : "Failed to suspend sale.");
    } finally {
      setCheckoutBusy(false);
    }
  };

  const resumeSuspendedSale = async (saleId: number) => {
    setCheckoutBusy(true);
    setError("");
    try {
      const response = await api.post<{
        suspendedSale: SuspendedSale;
        resumeCart: Array<{ product: Product; quantity: number }>;
      }>(`/api/orders/suspended/${saleId}/resume`, {});

      const nextCart: Record<number, CartLine> = {};
      for (const line of response.resumeCart) {
        nextCart[line.product.id] = {
          product: line.product,
          quantity: line.quantity
        };
      }

      setCart(nextCart);
      setResumedSaleId(response.suspendedSale.id);
      setCustomerId(response.suspendedSale.customerId ? String(response.suspendedSale.customerId) : "");
      await loadProducts();
      await loadSuspendedSales();
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "Failed to resume suspended sale.");
    } finally {
      setCheckoutBusy(false);
    }
  };

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const configResponse = await api.get<{ taxRate: number; kioskMode?: boolean }>("/api/config");
        setTaxRate(configResponse.taxRate);
        setKioskMode(configResponse.kioskMode !== false);
      } catch {
        // Keep defaults for resilient cashier flow.
      }

      const session = await loadCurrentRegisterSession();
      if (session) {
        await loadSuspendedSales();
      }
    };

    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSearch]);

  useEffect(() => {
    if (!kioskMode) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "F5" ||
        (event.ctrlKey && ["r", "R"].includes(event.key)) ||
        (event.altKey && event.key === "ArrowLeft")
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [kioskMode]);

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
    if (!registerSession) {
      setError("Open a register session before checkout.");
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
        registerSessionId: registerSession.id,
        suspendedSaleId: resumedSaleId,
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
      setResumedSaleId(null);
      resetCheckoutFields();
      setCheckoutOpen(false);
      await loadSuspendedSales();
      navigate(`/pos/receipt/${response.order.id}`);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Checkout failed.");
    } finally {
      setCheckoutBusy(false);
    }
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
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

  const onScanKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    void simulateScan();
  };

  const openCheckout = () => {
    if (!cartLines.length) {
      setError("Cart is empty.");
      return;
    }
    if (!registerSession) {
      setError("Open a register session before checkout.");
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
          <span className="muted">{registerSession ? `Session #${registerSession.id}` : "Session closed"}</span>
        </div>
        <div className="register-session-box">
          <div>
            <strong>{registerSession ? "Shift Active" : "Shift Closed"}</strong>
            <p className="muted">
              {registerSession
                ? `${registerSession.register?.identifier || "REGISTER"} opened ${new Date(
                    registerSession.openedAt
                  ).toLocaleTimeString()}`
                : "Open a register session before checkout."}
            </p>
          </div>
          {!registerSession ? (
            <div className="register-session-actions">
              <input
                aria-label="Register id"
                value={registerIdInput}
                onChange={(event) => setRegisterIdInput(event.target.value.replace(/\D/g, ""))}
                placeholder="Register Id"
              />
              <input
                aria-label="Opening float"
                value={openingFloatInput}
                onChange={(event) => setOpeningFloatInput(event.target.value.replace(/[^\d.]/g, ""))}
                placeholder="Opening float (e.g. 100.00)"
              />
              <button type="button" onClick={openRegisterSession} disabled={registerBusy}>
                {registerBusy ? "Opening..." : "Open Shift"}
              </button>
            </div>
          ) : (
            <div className="button-row">
              <button type="button" onClick={recordNoSaleDrawerEvent} disabled={registerBusy}>
                Drawer No-Sale
              </button>
              <button type="button" onClick={closeRegisterSession} disabled={registerBusy}>
                {registerBusy ? "Closing..." : "Close Shift"}
              </button>
            </div>
          )}
        </div>

        <div className="toolbar-row register-toolbar">
          <input
            placeholder="Scanner code (barcode or SKU)"
            value={scanCode}
            onChange={(event) => setScanCode(event.target.value)}
            onKeyDown={onScanKeyDown}
            aria-label="Scanner simulation code"
          />
          <button type="button" onClick={simulateScan} disabled={scanBusy || !scanCode.trim()}>
            {scanBusy ? "Scanning..." : "Simulate Scan"}
          </button>
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
          {products.map((product) => {
            const imageSrc = getProductImageSrc(product);

            return (
              <article key={product.id} className="product-card">
                <div className="product-card-media">
                  {imageSrc ? (
                    <img src={imageSrc} alt={product.name} loading="lazy" decoding="async" />
                  ) : (
                    <div
                      className="product-card-image-fallback"
                      aria-label={`${product.name} image unavailable`}
                    />
                  )}
                </div>
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
            );
          })}
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

        {suspendedSales.length > 0 ? (
          <div className="suspended-sales-box">
            <div className="panel-header-row">
              <h3>Suspended Sales</h3>
              <span className="muted">{suspendedSales.length}</span>
            </div>
            <div className="suspended-sales-list">
              {suspendedSales.map((sale) => (
                <div key={sale.id} className="suspended-sale-row">
                  <div>
                    <strong>Hold #{sale.id}</strong>
                    <p className="muted">{new Date(sale.suspendedAt).toLocaleTimeString()}</p>
                  </div>
                  <div>
                    <strong>{formatCents(sale.totalCents)}</strong>
                  </div>
                  <button type="button" onClick={() => resumeSuspendedSale(sale.id)} disabled={checkoutBusy}>
                    Resume
                  </button>
                </div>
              ))}
            </div>
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
            className="button-quiet"
            onClick={suspendCurrentSale}
            disabled={checkoutBusy || cartLines.length === 0 || !registerSession}
          >
            Suspend Sale
          </button>
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
            {resumedSaleId ? (
              <div className="empty-state">Resumed hold #{resumedSaleId}. Completing this sale will close it.</div>
            ) : null}

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

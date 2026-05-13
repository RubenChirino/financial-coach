// Transactions list + Add bank flow (modal)

function TransactionsPage({ ctx }) {
  const { transactions, categories, banks, currency, privacy } = ctx;
  const [filterCat, setFilterCat] = useState("all");
  const [filterBank, setFilterBank] = useState("all");
  const [search, setSearch] = useState("");

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const bankMap = Object.fromEntries(banks.map((b) => [b.id, b]));

  const filtered = transactions.filter((t) => {
    if (filterCat !== "all" && t.category !== filterCat) return false;
    if (filterBank !== "all" && t.bank !== filterBank) return false;
    if (search && !t.merchant.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // group by date
  const grouped = {};
  filtered.forEach((t) => {
    (grouped[t.date] = grouped[t.date] || []).push(t);
  });
  const dates = Object.keys(grouped).sort().reverse();

  const totalIn = filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = filtered.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const fmtDate = (d) => {
    const dt = new Date(d);
    const today = new Date("2026-04-20");
    const diff = Math.round((today - dt) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return dt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display">Transactions</h1>
          <div className="sub">
            {filtered.length} transactions · across {banks.length} accounts
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-outline">
            <Icon name="download" size={14} /> Export CSV
          </button>
          <button className="btn btn-creative">
            <Icon name="sparkles" size={14} /> Auto-categorize
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="bento" style={{ marginBottom: 16 }}>
        <div className="col-4 card card-pad">
          <div className="stat">
            <div className="label">Money in</div>
            <div
              className={`value ${privacy ? "balance-hidden" : ""}`}
              style={{ color: "#059669" }}
            >
              +{fmt(totalIn, currency)}
            </div>
          </div>
        </div>
        <div className="col-4 card card-pad">
          <div className="stat">
            <div className="label">Money out</div>
            <div className={`value ${privacy ? "balance-hidden" : ""}`}>
              {fmt(-totalOut, currency)}
            </div>
          </div>
        </div>
        <div className="col-4 card card-pad">
          <div className="stat">
            <div className="label">Net flow</div>
            <div
              className={`value ${privacy ? "balance-hidden" : ""}`}
              style={{ color: totalIn - totalOut >= 0 ? "#059669" : "#DC2626" }}
            >
              {totalIn - totalOut >= 0 ? "+" : ""}
              {fmt(totalIn - totalOut, currency)}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card card-pad" style={{ marginBottom: 16, padding: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div
            className="search"
            style={{
              background: "var(--surface-app)",
              padding: "7px 12px",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flex: 1,
              minWidth: 240,
            }}
          >
            <Icon name="search" size={14} />
            <input
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                flex: 1,
                color: "inherit",
                fontFamily: "inherit",
                fontSize: 13,
              }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchants…"
            />
          </div>
          <select
            value={filterBank}
            onChange={(e) => setFilterBank(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-default)",
              background: "var(--surface-card)",
              color: "var(--text-primary)",
              fontFamily: "inherit",
              fontSize: 13,
            }}
          >
            <option value="all">All banks</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-default)",
              background: "var(--surface-card)",
              color: "var(--text-primary)",
              fontFamily: "inherit",
              fontSize: 13,
            }}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setFilterCat("all");
              setFilterBank("all");
              setSearch("");
            }}
          >
            <Icon name="x" size={13} /> Clear
          </button>
        </div>
      </div>

      {/* List grouped by date */}
      <div className="card" style={{ overflow: "hidden" }}>
        {dates.map((date) => (
          <div key={date}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 20px",
                background: "var(--surface-app)",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <div>{fmtDate(date)}</div>
              <div className={privacy ? "balance-hidden" : ""}>
                {fmt(
                  grouped[date].reduce((s, t) => s + t.amount, 0),
                  currency,
                  { signed: true },
                )}
              </div>
            </div>
            {grouped[date].map((t, _i) => {
              const cat = t.category ? catMap[t.category] : null;
              const bank = bankMap[t.bank];
              return (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 20px",
                    borderTop: "1px solid var(--border-default)",
                    transition: "background 120ms",
                    cursor: "pointer",
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.background = "var(--brand-primary-soft)")
                  }
                  onMouseOut={(e) => (e.currentTarget.style.background = "")}
                >
                  {cat ? (
                    <CategoryIcon cat={cat} size={36} />
                  ) : (
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: "#DCFCE7",
                        color: "#166534",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name="arrow-down-left" size={16} stroke={2.5} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t.merchant}</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-tertiary)",
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginTop: 2,
                      }}
                    >
                      {cat && (
                        <span
                          className="pill"
                          style={{
                            background: `${cat.color}22`,
                            color: cat.color,
                            fontWeight: 600,
                          }}
                        >
                          {cat.name}
                        </span>
                      )}
                      <span>{bank.name}</span>
                      {t.note && (
                        <>
                          <span>·</span>
                          <span>{t.note}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div
                    className={`tnum ${privacy ? "balance-hidden" : ""}`}
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: t.amount > 0 ? "#059669" : "var(--text-primary)",
                    }}
                  >
                    {t.amount > 0 ? "+" : ""}
                    {fmt(t.amount, currency)}
                  </div>
                  <button className="icon-btn">
                    <Icon name="sparkles" size={14} stroke={2.5} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {dates.length === 0 && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-tertiary)" }}>
            <Icon name="search-x" size={32} />
            <div style={{ marginTop: 10, fontSize: 14 }}>No transactions match your filters.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddBankModal({ open, onClose, onAdd }) {
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelected(null);
      setSearch("");
      setConnecting(false);
    }
  }, [open]);

  if (!open) return null;

  const list = MOCK.availableBanks.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()),
  );

  const connect = () => {
    setConnecting(true);
    setTimeout(() => {
      setConnecting(false);
      setStep(3);
    }, 1400);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(15, 20, 33, 0.4)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid var(--border-default)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "var(--brand-primary-soft)",
                color: "var(--brand-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="landmark" size={16} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Connect a new account</div>
              <div className="caption">Step {step} of 3 · secure via Open Banking</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {step === 1 && (
            <div>
              <div style={{ marginBottom: 14, position: "relative" }}>
                <input
                  style={{
                    width: "100%",
                    padding: "10px 14px 10px 38px",
                    borderRadius: 10,
                    border: "1px solid var(--border-default)",
                    background: "var(--surface-app)",
                    color: "var(--text-primary)",
                    fontSize: 14,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                  placeholder="Search your bank…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  <Icon name="search" size={15} />
                </div>
              </div>
              <div className="caption" style={{ marginBottom: 10 }}>
                Popular in Spain
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {list.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setSelected(b);
                      setStep(2);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: 12,
                      borderRadius: 10,
                      border: "1px solid var(--border-default)",
                      background: "var(--surface-card)",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "inherit",
                      transition: "all 120ms",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = "var(--brand-primary)";
                      e.currentTarget.style.background = "var(--brand-primary-soft)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-default)";
                      e.currentTarget.style.background = "var(--surface-card)";
                    }}
                  >
                    <BankLogo bank={{ ...b, logoBg: b.color, logoText: b.name[0] }} size={34} />
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{b.name}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && selected && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: 14,
                  background: "var(--surface-app)",
                  borderRadius: 12,
                  marginBottom: 16,
                }}
              >
                <BankLogo
                  bank={{ ...selected, logoBg: selected.color, logoText: selected.name[0] }}
                  size={44}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{selected.name}</div>
                  <div className="caption">Open Banking secure connection</div>
                </div>
              </div>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--text-secondary)",
                  marginBottom: 16,
                }}
              >
                Coin will be able to <strong style={{ color: "var(--text-primary)" }}>read</strong>{" "}
                your balance, accounts, and transactions from {selected.name}. We cannot move money.
                You can revoke access at any time.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { icon: "eye", label: "Read account balances" },
                  { icon: "list", label: "Read transaction history (90 days)" },
                  { icon: "x-circle", label: "No money movement permission", deny: true },
                ].map((x, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: 10,
                      background: "var(--surface-app)",
                      borderRadius: 8,
                    }}
                  >
                    <Icon
                      name={x.icon}
                      size={14}
                      style={{ color: x.deny ? "#DC2626" : "#059669" }}
                    />
                    <span
                      style={{
                        fontSize: 13,
                        color: x.deny ? "var(--text-secondary)" : "var(--text-primary)",
                      }}
                    >
                      {x.label}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="btn btn-primary btn-lg"
                style={{ width: "100%", justifyContent: "center", marginTop: 18 }}
                onClick={connect}
                disabled={connecting}
              >
                {connecting ? (
                  <>
                    <Icon name="loader-2" size={15} /> Connecting…
                  </>
                ) : (
                  <>
                    Continue to {selected.name} <Icon name="arrow-right" size={15} />
                  </>
                )}
              </button>
            </div>
          )}

          {step === 3 && selected && (
            <div style={{ textAlign: "center", padding: "12px 8px" }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 999,
                  background: "#DCFCE7",
                  color: "#166534",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px",
                }}
              >
                <Icon name="check" size={32} stroke={3} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>
                {selected.name} connected
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "8px 0 20px" }}>
                We're syncing your last 90 days of transactions. This usually takes under a minute.
              </p>
              <button
                className="btn btn-primary btn-lg"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => {
                  onAdd(selected);
                  onClose();
                }}
              >
                Back to dashboard <Icon name="arrow-right" size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TransactionsPage, AddBankModal });

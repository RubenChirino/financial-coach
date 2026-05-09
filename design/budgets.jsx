// Budgets page — categories, per-category budgets, savings, trends

function BudgetsPage({ ctx }) {
  const { categories, currency, privacy, transactions } = ctx;
  const [selectedId, setSelectedId] = useState(categories[0].id);

  const totalBudget = categories.reduce((s, c) => s + c.budget, 0);
  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const totalIncome = 3890;
  const saved = totalIncome - totalSpent;
  const pctSaved = (saved / totalIncome) * 100;

  const sel = categories.find((c) => c.id === selectedId);
  const selTxs = transactions.filter((t) => t.category === selectedId).slice(0, 6);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display">Budgets & categories</h1>
          <div className="sub">April 2026 · 11 days in, 19 to go</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div className="seg">
            <button type="button" className="on">Month</button>
            <button type="button">Quarter</button>
            <button type="button">Year</button>
          </div>
          <button type="button" className="btn btn-primary">
            <Icon name="plus" size={14} /> New category
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div className="bento" style={{ marginBottom: 24 }}>
        <div className="col-4 card card-pad">
          <div className="stat">
            <div className="label">Income · April</div>
            <div className={`value ${privacy ? "balance-hidden" : ""}`}>
              {fmt(totalIncome, currency)}
            </div>
            <div className="trend up">
              <Icon name="trending-up" size={12} stroke={2.5} /> +20% vs. March
            </div>
          </div>
        </div>
        <div className="col-4 card card-pad">
          <div className="stat">
            <div className="label">Spent</div>
            <div className={`value ${privacy ? "balance-hidden" : ""}`}>
              {fmt(totalSpent, currency)}
            </div>
            <div className="trend up">
              <Icon name="trending-down" size={12} stroke={2.5} /> −8.5% vs. March
            </div>
          </div>
          <div className="bar" style={{ marginTop: 12 }}>
            <div
              className="bar-fill"
              style={{ width: `${Math.min(100, (totalSpent / totalBudget) * 100)}%` }}
            />
          </div>
          <div className="caption" style={{ marginTop: 6 }}>
            {Math.round((totalSpent / totalBudget) * 100)}% of{" "}
            {fmt(totalBudget, currency, { round: true })} budget
          </div>
        </div>
        <div
          className="col-4 card card-pad"
          style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 100%)", color: "#fff" }}
        >
          <div className="stat">
            <div className="label" style={{ color: "rgba(255,255,255,0.85)" }}>
              Saved this month
            </div>
            <div className={`value ${privacy ? "balance-hidden" : ""}`}>{fmt(saved, currency)}</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.9 }}>
              {pctSaved.toFixed(0)}% savings rate · best in 2026
            </div>
          </div>
          <div className="bar" style={{ marginTop: 12, background: "rgba(255,255,255,0.25)" }}>
            <div className="bar-fill" style={{ width: `${pctSaved}%`, background: "#fff" }} />
          </div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 6 }}>
            Goal: 20% · you're 4pts ahead
          </div>
        </div>
      </div>

      {/* Two-col: categories left, detail right */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        {/* Categories list */}
        <div className="card" style={{ padding: 8 }}>
          <div
            style={{
              padding: "12px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3 style={{ margin: 0 }}>All categories</h3>
            <div className="caption">9 categories · click to view</div>
          </div>
          <div>
            {categories.map((cat) => {
              const pct = Math.min(100, (cat.spent / cat.budget) * 100);
              const over = cat.spent > cat.budget;
              const selected = cat.id === selectedId;
              return (
                <button
                  type="button"
                  key={cat.id}
                  onClick={() => setSelectedId(cat.id)}
                  style={{
                    background: selected ? "var(--brand-primary-soft)" : "transparent",
                    border: "none",
                    borderRadius: 10,
                    padding: "12px 14px",
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    cursor: "pointer",
                    textAlign: "left",
                    color: "inherit",
                    margin: "2px 0",
                    transition: "background 120ms",
                  }}
                >
                  <CategoryIcon cat={cat} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{cat.name}</div>
                      <div
                        className={`tnum ${privacy ? "balance-hidden" : ""}`}
                        style={{ fontSize: 13, fontWeight: 600 }}
                      >
                        {fmt(cat.spent, currency)}
                        <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>
                          {" "}
                          / {fmt(cat.budget, currency, { round: true })}
                        </span>
                      </div>
                    </div>
                    <div className="bar" style={{ marginTop: 6 }}>
                      <div
                        className="bar-fill"
                        style={{ width: `${pct}%`, background: over ? "#EF4444" : cat.color }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        {Math.round(pct)}% used
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: over ? "#DC2626" : "var(--text-tertiary)",
                          fontWeight: over ? 600 : 400,
                        }}
                      >
                        {over
                          ? `€${(cat.spent - cat.budget).toFixed(2)} over`
                          : `€${(cat.budget - cat.spent).toFixed(2)} left`}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card card-pad">
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <CategoryIcon cat={sel} size={48} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {sel.name}
                </div>
                <div className="caption">April 2026</div>
              </div>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 10px" }}>
                <Icon name="settings-2" size={13} /> Edit
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 14,
                marginBottom: 16,
              }}
            >
              <div>
                <div className="caption">Spent</div>
                <div
                  className={`tnum ${privacy ? "balance-hidden" : ""}`}
                  style={{ fontSize: 20, fontWeight: 600 }}
                >
                  {fmt(sel.spent, currency)}
                </div>
              </div>
              <div>
                <div className="caption">Budget</div>
                <div className="tnum" style={{ fontSize: 20, fontWeight: 600 }}>
                  {fmt(sel.budget, currency, { round: true })}
                </div>
              </div>
              <div>
                <div className="caption">{sel.spent > sel.budget ? "Over by" : "Remaining"}</div>
                <div
                  className={`tnum ${privacy ? "balance-hidden" : ""}`}
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: sel.spent > sel.budget ? "#DC2626" : "#059669",
                  }}
                >
                  {fmt(Math.abs(sel.budget - sel.spent), currency)}
                </div>
              </div>
            </div>

            <div className="bar" style={{ height: 10 }}>
              <div
                className="bar-fill"
                style={{
                  width: `${Math.min(100, (sel.spent / sel.budget) * 100)}%`,
                  background: sel.spent > sel.budget ? "#EF4444" : sel.color,
                }}
              />
            </div>

            <hr className="divider" style={{ margin: "16px 0" }} />

            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-tertiary)",
                marginBottom: 8,
              }}
            >
              Recent in {sel.name.toLowerCase()}
            </div>
            {selTxs.length === 0 ? (
              <div className="caption">No transactions this month.</div>
            ) : (
              selTxs.map((t, i) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderTop: i === 0 ? "none" : "1px solid var(--border-default)",
                  }}
                >
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{t.merchant}</div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    {t.date.slice(5)}
                  </div>
                  <div
                    className={`tnum ${privacy ? "balance-hidden" : ""}`}
                    style={{ fontSize: 13, fontWeight: 600 }}
                  >
                    {fmt(t.amount, currency)}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* AI nudge */}
          <div
            className="card card-pad"
            style={{ background: "var(--creative-pink)", color: "var(--creative-pink-text)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Icon name="sparkles" size={16} stroke={2.5} />
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Coach tip
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>
              {sel.spent > sel.budget
                ? `You're over on ${sel.name.toLowerCase()} — biggest driver is €${Math.max(...selTxs.map((t) => Math.abs(t.amount))).toFixed(2)} at ${selTxs[0]?.merchant}. Want me to suggest[...]
                : `You have €${(sel.budget - sel.spent).toFixed(2)} left for ${sel.name.toLowerCase()} this month. At your current pace, you'll finish 8% under budget.`}
            </div>
            <button
              type="button"
              className="btn"
              style={{ background: "var(--text-primary)", color: "#fff", marginTop: 12 }}
            >
              Ask coach <Icon name="arrow-right" size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BudgetsPage });

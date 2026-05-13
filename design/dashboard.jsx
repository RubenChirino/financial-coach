// Dashboard with 3 variations: 'bento', 'command', 'focus'
// Variation controls overall layout + emphasis

// ── Shared mini-chart components ──
function Sparkline({ values, color = "#5389FF", height = 40, width = 120, fill = true }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return [x, y];
  });
  const d = pts.map((p, i) => `${(i === 0 ? "M" : "L") + p[0]},${p[1]}`).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {fill && <path d={area} fill={color} fillOpacity="0.12" />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Donut({ segments, size = 120, thickness = 16, center }) {
  // segments: [{ value, color, label }]
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="var(--brand-primary-soft)"
          strokeWidth={thickness}
          fill="none"
        />
        {segments.map((seg, i) => {
          const len = (seg.value / total) * C;
          const gap = C - len;
          const el = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              stroke={seg.color}
              strokeWidth={thickness}
              fill="none"
              strokeDasharray={`${len} ${gap}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {center && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          {center}
        </div>
      )}
    </div>
  );
}

function Bars({ data, height = 120, currency }) {
  // data: [{m, in, out}]
  const max = Math.max(...data.flatMap((d) => [d.in, d.out]));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${data.length}, 1fr)`,
        gap: 10,
        alignItems: "end",
        height,
      }}
    >
      {data.map((d, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            height: "100%",
            justifyContent: "flex-end",
          }}
        >
          <div style={{ display: "flex", gap: 3, alignItems: "end", height: "100%" }}>
            <div
              style={{
                width: 10,
                borderRadius: 3,
                height: `${(d.in / max) * 100}%`,
                background: "var(--brand-primary)",
                transition: "height 400ms ease",
              }}
              title={`In: ${fmt(d.in, currency)}`}
            />
            <div
              style={{
                width: 10,
                borderRadius: 3,
                height: `${(d.out / max) * 100}%`,
                background: "var(--creative-pink)",
                transition: "height 400ms ease",
              }}
              title={`Out: ${fmt(d.out, currency)}`}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 500 }}>{d.m}</div>
        </div>
      ))}
    </div>
  );
}

// ── Small components ──
function TotalBalanceCard({ banks, currency, privacy, variant }) {
  const total = banks.reduce((s, b) => s + b.balance, 0);
  const lastMonth = total * 0.962;
  const delta = ((total - lastMonth) / lastMonth) * 100;

  return (
    <div
      className="card card-pad"
      style={{
        background:
          variant === "command" ? "linear-gradient(135deg, #5389FF 0%, #3E76F2 100%)" : undefined,
        color: variant === "command" ? "#fff" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              opacity: 0.8,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Total net worth
          </div>
          <div
            className={`tnum ${privacy ? "balance-hidden" : ""}`}
            style={{
              fontSize: 38,
              lineHeight: "44px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              marginTop: 4,
            }}
          >
            {fmt(total, currency)}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                fontWeight: 600,
                background: variant === "command" ? "rgba(255,255,255,0.2)" : "#DCFCE7",
                color: variant === "command" ? "#fff" : "#166534",
                padding: "3px 8px",
                borderRadius: 6,
              }}
            >
              <Icon name="trending-up" size={12} stroke={2.5} />+{delta.toFixed(1)}%
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>vs. last month</div>
          </div>
        </div>
        <Sparkline
          values={[10, 14, 12, 16, 15, 20, 22, 25, 24, 28]}
          color={variant === "command" ? "#FFD1DC" : "#5389FF"}
          width={130}
          height={52}
        />
      </div>
      <hr
        className="divider"
        style={{ margin: "18px 0", opacity: variant === "command" ? 0.2 : 1 }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[
          { label: "Income (Apr)", value: 3890, trend: "+20%", up: true },
          { label: "Expenses", value: 2395, trend: "−8.5%", up: true },
          { label: "Saved", value: 1495, trend: "+54%", up: true },
        ].map((k) => (
          <div key={k.label}>
            <div
              style={{
                fontSize: 11,
                opacity: 0.7,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {k.label}
            </div>
            <div
              className={`tnum ${privacy ? "balance-hidden" : ""}`}
              style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}
            >
              {fmt(k.value, currency, { round: true })}
            </div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 1 }}>{k.trend} vs. Mar</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BankTile({ bank, currency, privacy, onClick, compact }) {
  return (
    <button
      onClick={onClick}
      className="card card-hover"
      style={{
        textAlign: "left",
        padding: compact ? 14 : 18,
        border: "none",
        width: "100%",
        background: "var(--surface-card)",
        color: "var(--text-primary)",
        cursor: "pointer",
      }}
    >
      <div
        style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: compact ? 8 : 12 }}
      >
        <BankLogo bank={bank} size={compact ? 32 : 40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{bank.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
            {bank.accountLabel} · ••{bank.last4}
          </div>
        </div>
        <Icon name="chevron-right" size={16} style={{ color: "var(--text-tertiary)" }} />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div
          className={`tnum ${privacy ? "balance-hidden" : ""}`}
          style={{ fontSize: compact ? 18 : 22, fontWeight: 600, letterSpacing: "-0.015em" }}
        >
          {fmt(bank.balance, currency)}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: bank.delta >= 0 ? "#059669" : "#DC2626",
          }}
        >
          {bank.delta >= 0 ? "+" : ""}
          {bank.delta}%
        </div>
      </div>
    </button>
  );
}

function AddBankTile({ onClick, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "1.5px dashed var(--border-strong)",
        borderRadius: 14,
        padding: 18,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 120,
        color: "var(--text-secondary)",
        transition: "all 150ms",
        ...style,
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "var(--brand-primary)";
        e.currentTarget.style.background = "var(--brand-primary-soft)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "var(--border-strong)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--brand-primary-soft)",
          color: "var(--brand-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="plus" size={18} stroke={2.5} />
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>Add a bank</div>
      <div style={{ fontSize: 11, textAlign: "center", maxWidth: 140 }}>
        Connect bank, card, loan or investments
      </div>
    </button>
  );
}

function CategoriesCard({ categories, currency, privacy, onOpen }) {
  const top = categories.filter((c) => c.id !== "savings").slice(0, 4);
  return (
    <div className="card card-pad" style={{ height: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <h3 style={{ margin: 0 }}>Spending by category</h3>
        <button
          className="btn btn-ghost"
          style={{ padding: "4px 8px", fontSize: 12 }}
          onClick={onOpen}
        >
          View all <Icon name="arrow-right" size={12} />
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {top.map((cat) => {
          const pct = Math.min(100, (cat.spent / cat.budget) * 100);
          const over = cat.spent > cat.budget;
          return (
            <div key={cat.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <CategoryIcon cat={cat} size={28} />
                <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{cat.name}</div>
                <div
                  className={`tnum ${privacy ? "balance-hidden" : ""}`}
                  style={{ fontSize: 12, fontWeight: 600 }}
                >
                  {fmt(cat.spent, currency)}
                  <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>
                    {" "}
                    / {fmt(cat.budget, currency, { round: true })}
                  </span>
                </div>
              </div>
              <div className="bar">
                <div
                  className={`bar-fill${over ? " danger" : pct > 85 ? " warn" : ""}`}
                  style={{ width: `${pct}%`, background: over ? "#EF4444" : cat.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsightCard({ insight, currency, onDismiss }) {
  const kindStyles = {
    warning: { bg: "#FEF3C7", fg: "#92400E", icon: "alert-triangle" },
    positive: { bg: "#DCFCE7", fg: "#166534", icon: "trending-up" },
    suggestion: { bg: "var(--creative-pink)", fg: "var(--creative-pink-text)", icon: "sparkles" },
    neutral: { bg: "var(--brand-primary-soft)", fg: "var(--brand-primary)", icon: "calendar" },
  };
  const k = kindStyles[insight.kind] || kindStyles.neutral;
  return (
    <div className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: k.bg,
          color: k.fg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name={insight.icon} size={18} stroke={2} />
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>{insight.title}</div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{insight.time}</div>
        </div>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            margin: "4px 0 10px",
            lineHeight: 1.5,
          }}
        >
          {insight.body}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 12 }}>
            {insight.action} <Icon name="arrow-right" size={12} />
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: "6px 12px", fontSize: 12 }}
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function RecentTransactions({
  transactions,
  categories,
  banks,
  currency,
  privacy,
  onOpen,
  limit = 5,
}) {
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const bankMap = Object.fromEntries(banks.map((b) => [b.id, b]));
  return (
    <div
      className="card card-pad"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <h3 style={{ margin: 0 }}>Recent activity</h3>
        <button
          className="btn btn-ghost"
          style={{ padding: "4px 8px", fontSize: 12 }}
          onClick={onOpen}
        >
          See all <Icon name="arrow-right" size={12} />
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {transactions.slice(0, limit).map((t, i) => {
          const cat = t.category ? catMap[t.category] : null;
          const bank = bankMap[t.bank];
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--border-default)",
              }}
            >
              {cat ? (
                <CategoryIcon cat={cat} size={34} />
              ) : (
                <div
                  style={{
                    width: 34,
                    height: 34,
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
                <div style={{ fontSize: 13, fontWeight: 500 }}>{t.merchant}</div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                  {cat ? cat.name : "Income"} · {bank.name}
                </div>
              </div>
              <div
                className={`tnum ${privacy ? "balance-hidden" : ""}`}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: t.amount > 0 ? "#059669" : "var(--text-primary)",
                }}
              >
                {t.amount > 0 ? "+" : ""}
                {fmt(t.amount, currency)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthlyFlowCard({ currency, privacy }) {
  return (
    <div className="card card-pad" style={{ height: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Monthly flow</h3>
          <div className="caption" style={{ marginTop: 2 }}>
            Last 6 months · income vs. expenses
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{ width: 8, height: 8, borderRadius: 2, background: "var(--brand-primary)" }}
            />{" "}
            Income
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{ width: 8, height: 8, borderRadius: 2, background: "var(--creative-pink)" }}
            />{" "}
            Expenses
          </div>
        </div>
      </div>
      <Bars data={MOCK.spendByMonth} height={140} currency={currency} />
    </div>
  );
}

function DonutCard({ categories, currency, privacy }) {
  const segments = categories
    .filter((c) => c.id !== "savings")
    .map((c) => ({ value: c.spent, color: c.color, label: c.name }));
  const total = segments.reduce((s, x) => s + x.value, 0);
  const top3 = [...categories]
    .filter((c) => c.id !== "savings")
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 3);
  return (
    <div className="card card-pad" style={{ height: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 10,
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>April spend</h3>
          <div className="caption" style={{ marginTop: 2 }}>
            Breakdown by category
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <Donut
          segments={segments}
          size={130}
          thickness={14}
          center={
            <>
              <div
                className={privacy ? "balance-hidden" : ""}
                style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em" }}
              >
                {fmt(total, currency, { round: true })}
              </div>
              <div className="caption">of €2,395</div>
            </>
          }
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {top3.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
              <div style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{c.name}</div>
              <div
                className={`tnum ${privacy ? "balance-hidden" : ""}`}
                style={{ fontSize: 12, fontWeight: 600 }}
              >
                {fmt(c.spent, currency)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CoachBriefCard({ onOpen }) {
  return (
    <div
      className="card card-pad"
      style={{
        background: "linear-gradient(135deg, #FFD1DC 0%, #D4E6FF 100%)",
        color: "var(--text-primary)",
        position: "relative",
        overflow: "hidden",
        height: "100%",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -30,
          right: -30,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.35)",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: "linear-gradient(135deg, #5389FF, #FFD1DC)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <Icon name="sparkles" size={16} stroke={2.5} />
            </div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              AI Daily brief
            </div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
            Good morning, Ana. You're on track to save{" "}
            <span style={{ background: "#fff", padding: "0 6px", borderRadius: 6 }}>€1,495</span>{" "}
            this month — your best April ever.
          </div>
          <div
            style={{ fontSize: 13, marginTop: 10, lineHeight: 1.5, color: "rgba(15,20,33,0.75)" }}
          >
            I spotted 3 suggestions that could add another €19/month. Want to review?
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            className="btn"
            style={{ background: "var(--text-primary)", color: "#fff" }}
            onClick={onOpen}
          >
            Open brief <Icon name="arrow-right" size={14} />
          </button>
          <button
            className="btn btn-ghost"
            style={{ background: "rgba(255,255,255,0.5)" }}
            onClick={onOpen}
          >
            Ask coach
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Layout variations ──
function DashboardBento({ ctx }) {
  const {
    currency,
    privacy,
    setPrivacy,
    banks,
    categories,
    transactions,
    insights,
    setRoute,
    addBank,
  } = ctx;
  const primaryInsight = insights[0];
  return (
    <div className="bento">
      <div className="col-8">
        <TotalBalanceCard banks={banks} currency={currency} privacy={privacy} variant="bento" />
      </div>
      <div className="col-4">
        <CoachBriefCard onOpen={() => setRoute("coach")} />
      </div>

      <div className="col-12">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            marginTop: 4,
          }}
        >
          <h2>Your accounts</h2>
          <button className="btn btn-outline" onClick={addBank}>
            <Icon name="plus" size={14} /> Add account
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          {banks.map((b) => (
            <BankTile
              key={b.id}
              bank={b}
              currency={currency}
              privacy={privacy}
              onClick={() => setRoute("transactions")}
            />
          ))}
          <AddBankTile onClick={addBank} />
        </div>
      </div>

      <div className="col-7">
        <MonthlyFlowCard currency={currency} privacy={privacy} />
      </div>
      <div className="col-5">
        <DonutCard categories={categories} currency={currency} privacy={privacy} />
      </div>

      <div className="col-7">
        <RecentTransactions
          transactions={transactions}
          categories={categories}
          banks={banks}
          currency={currency}
          privacy={privacy}
          onOpen={() => setRoute("transactions")}
        />
      </div>
      <div className="col-5">
        <CategoriesCard
          categories={categories}
          currency={currency}
          privacy={privacy}
          onOpen={() => setRoute("budgets")}
        />
      </div>

      <div className="col-12">
        <InsightCard insight={primaryInsight} currency={currency} onDismiss={() => {}} />
      </div>
    </div>
  );
}

function DashboardCommand({ ctx }) {
  const { currency, privacy, banks, categories, transactions, insights, setRoute, addBank } = ctx;
  return (
    <div className="bento">
      <div className="col-12">
        <TotalBalanceCard banks={banks} currency={currency} privacy={privacy} variant="command" />
      </div>

      <div className="col-8">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2>Your accounts</h2>
          <button className="btn btn-outline" onClick={addBank}>
            <Icon name="plus" size={14} /> Add account
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {banks.slice(0, 4).map((b) => (
            <BankTile
              key={b.id}
              bank={b}
              currency={currency}
              privacy={privacy}
              compact
              onClick={() => setRoute("transactions")}
            />
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <MonthlyFlowCard currency={currency} privacy={privacy} />
        </div>
      </div>

      <div className="col-4">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
          <CoachBriefCard onOpen={() => setRoute("coach")} />
          <DonutCard categories={categories} currency={currency} privacy={privacy} />
        </div>
      </div>

      <div className="col-6">
        <RecentTransactions
          transactions={transactions}
          categories={categories}
          banks={banks}
          currency={currency}
          privacy={privacy}
          onOpen={() => setRoute("transactions")}
          limit={6}
        />
      </div>
      <div className="col-6">
        <CategoriesCard
          categories={categories}
          currency={currency}
          privacy={privacy}
          onOpen={() => setRoute("budgets")}
        />
      </div>
    </div>
  );
}

function DashboardFocus({ ctx }) {
  const { currency, privacy, banks, categories, transactions, insights, setRoute, addBank } = ctx;
  const total = banks.reduce((s, b) => s + b.balance, 0);

  return (
    <div className="bento">
      {/* Hero strip: big total + AI brief */}
      <div className="col-12">
        <div
          className="card"
          style={{
            padding: "32px 36px",
            background:
              "linear-gradient(135deg, rgba(255,209,220,0.4) 0%, rgba(212,230,255,0.6) 100%)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr",
              gap: 32,
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-secondary)",
                }}
              >
                Monday, April 20 · Net worth
              </div>
              <div
                className={`tnum ${privacy ? "balance-hidden" : ""}`}
                style={{
                  fontSize: 56,
                  lineHeight: "60px",
                  fontWeight: 600,
                  letterSpacing: "-0.025em",
                  marginTop: 6,
                }}
              >
                {fmt(total, currency)}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                <span className="pill pill-success">
                  <Icon name="trending-up" size={12} />
                  +3.8% this month
                </span>
                <span className="pill">5 accounts · 2 banks on watch</span>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button className="btn btn-primary btn-lg" onClick={addBank}>
                  <Icon name="plus" size={16} /> Add account
                </button>
                <button className="btn btn-outline btn-lg" onClick={() => setRoute("coach")}>
                  <Icon name="sparkles" size={16} /> Ask the coach
                </button>
              </div>
            </div>

            <div className="card card-pad" style={{ background: "var(--surface-card)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: "linear-gradient(135deg, #5389FF, #FFD1DC)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                  }}
                >
                  <Icon name="sparkles" size={14} stroke={2.5} />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-tertiary)",
                  }}
                >
                  Today's focus
                </div>
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  lineHeight: 1.4,
                  letterSpacing: "-0.005em",
                }}
              >
                {insights[0].title}
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  margin: "6px 0 12px",
                  lineHeight: 1.5,
                }}
              >
                {insights[0].body}
              </p>
              <button
                className="btn btn-creative"
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setRoute("coach")}
              >
                {insights[0].action} <Icon name="arrow-right" size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Accounts horizontal strip */}
      <div className="col-12">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2>Accounts</h2>
          <div className="caption">5 connected · last synced 2 min ago</div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          {banks.map((b) => (
            <BankTile
              key={b.id}
              bank={b}
              currency={currency}
              privacy={privacy}
              compact
              onClick={() => setRoute("transactions")}
            />
          ))}
          <AddBankTile onClick={addBank} style={{ minHeight: 100 }} />
        </div>
      </div>

      <div className="col-5">
        <DonutCard categories={categories} currency={currency} privacy={privacy} />
      </div>
      <div className="col-7">
        <MonthlyFlowCard currency={currency} privacy={privacy} />
      </div>

      <div className="col-7">
        <RecentTransactions
          transactions={transactions}
          categories={categories}
          banks={banks}
          currency={currency}
          privacy={privacy}
          onOpen={() => setRoute("transactions")}
        />
      </div>
      <div className="col-5">
        <CategoriesCard
          categories={categories}
          currency={currency}
          privacy={privacy}
          onOpen={() => setRoute("budgets")}
        />
      </div>
    </div>
  );
}

function DashboardPage({ ctx, variant }) {
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display">{greeting}, Ana</h1>
          <div className="sub">Here's your financial picture — Monday, April 20, 2026</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-outline">
            <Icon name="download" size={14} /> Export
          </button>
          <button className="btn btn-creative">
            <Icon name="sparkles" size={14} /> Ask coach
          </button>
        </div>
      </div>

      {variant === "bento" && <DashboardBento ctx={ctx} />}
      {variant === "command" && <DashboardCommand ctx={ctx} />}
      {variant === "focus" && <DashboardFocus ctx={ctx} />}
    </div>
  );
}

Object.assign(window, {
  DashboardPage,
  BankTile,
  AddBankTile,
  Sparkline,
  Donut,
  Bars,
  CategoryIcon,
  InsightCard,
});

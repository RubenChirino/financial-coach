// App shell: sidebar navigation + topbar

function Sidebar({ route, setRoute, unread }) {
  const items = [
    { key: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
    { key: "coach", label: "AI Coach", icon: "sparkles", badge: unread },
    { key: "budgets", label: "Budgets", icon: "pie-chart" },
    { key: "transactions", label: "Transactions", icon: "arrow-left-right" },
    { key: "banks", label: "Banks & cards", icon: "landmark" },
  ];
  const more = [
    { key: "goals", label: "Goals", icon: "target" },
    { key: "settings", label: "Settings", icon: "settings" },
    { key: "help", label: "Help & support", icon: "life-buoy" },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-mark">
          <Icon name="sparkles" size={18} stroke={2.5} />
        </div>
        <div className="text">
          <div className="name">Coin</div>
          <div className="sub">Your AI money coach</div>
        </div>
      </div>

      <div className="nav-section-label">Main</div>
      {items.map((it) => (
        <button
          key={it.key}
          className={`nav-item${route === it.key ? " active" : ""}`}
          onClick={() => setRoute(it.key)}
        >
          <Icon name={it.icon} size={17} stroke={2} />
          <span className="txt">{it.label}</span>
          {it.badge ? <span className="badge">{it.badge}</span> : null}
        </button>
      ))}

      <div className="nav-section-label">Account</div>
      {more.map((it) => (
        <button
          key={it.key}
          className={`nav-item${route === it.key ? " active" : ""}`}
          onClick={() => setRoute(it.key)}
        >
          <Icon name={it.icon} size={17} stroke={2} />
          <span className="txt">{it.label}</span>
        </button>
      ))}

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="avatar">AM</div>
          <div>
            <div className="who">Ana Moreno</div>
            <div className="mail">ana@example.com</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ title, subtitle, onLock, privacy, setPrivacy, currency, setCurrency }) {
  return (
    <header className="topbar">
      <div>
        <div className="title">{title}</div>
        {subtitle ? <div className="caption">{subtitle}</div> : null}
      </div>
      <div className="spacer" />

      <div className="seg" title="Currency">
        <button className={currency === "EUR" ? "on" : ""} onClick={() => setCurrency("EUR")}>
          € EUR
        </button>
        <button className={currency === "USD" ? "on" : ""} onClick={() => setCurrency("USD")}>
          $ USD
        </button>
      </div>

      <div className="search">
        <Icon name="search" size={15} />
        <input placeholder="Search transactions, banks, insights…" />
        <kbd>⌘K</kbd>
      </div>

      <button
        className="icon-btn"
        title={privacy ? "Show balances" : "Hide balances"}
        onClick={() => setPrivacy(!privacy)}
      >
        <Icon name={privacy ? "eye-off" : "eye"} size={18} />
      </button>
      <button className="icon-btn" title="Notifications">
        <Icon name="bell" size={18} />
        <span className="dot" />
      </button>
      <button className="icon-btn" title="Lock app" onClick={onLock}>
        <Icon name="lock" size={18} />
      </button>
    </header>
  );
}

Object.assign(window, { Sidebar, Topbar });

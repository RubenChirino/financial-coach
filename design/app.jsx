// Root app: state, routing, Tweaks panel

const { useState, useEffect, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  darkMode: false,
  privacy: false,
  dashboardVariant: "bento",
  currency: "EUR",
} /*EDITMODE-END*/;

function TweaksPanel({ tweaks, setTweaks, open }) {
  const set = (k, v) => {
    const next = { ...tweaks, [k]: v };
    setTweaks(next);
    try {
      window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [k]: v } }, "*");
    } catch (_e) {}
  };
  return (
    <div className={`tweaks-panel${open ? " open" : ""}`}>
      <div className="tweaks-head">
        <div className="tweaks-title">Tweaks</div>
        <Icon name="sliders" size={14} style={{ color: "var(--text-tertiary)" }} />
      </div>

      <div className="tweak-row">
        <span>Dark mode</span>
        <button
          className={`switch${tweaks.darkMode ? " on" : ""}`}
          onClick={() => set("darkMode", !tweaks.darkMode)}
        />
      </div>
      <div className="tweak-row">
        <span>Privacy mode</span>
        <button
          className={`switch${tweaks.privacy ? " on" : ""}`}
          onClick={() => set("privacy", !tweaks.privacy)}
        />
      </div>
      <div className="tweak-row">
        <span>Currency</span>
        <div className="seg">
          <button
            className={tweaks.currency === "EUR" ? "on" : ""}
            onClick={() => set("currency", "EUR")}
          >
            €
          </button>
          <button
            className={tweaks.currency === "USD" ? "on" : ""}
            onClick={() => set("currency", "USD")}
          >
            $
          </button>
        </div>
      </div>
      <div className="tweak-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
        <span>Dashboard layout</span>
        <div className="seg" style={{ width: "100%" }}>
          <button
            style={{ flex: 1 }}
            className={tweaks.dashboardVariant === "bento" ? "on" : ""}
            onClick={() => set("dashboardVariant", "bento")}
          >
            Bento
          </button>
          <button
            style={{ flex: 1 }}
            className={tweaks.dashboardVariant === "command" ? "on" : ""}
            onClick={() => set("dashboardVariant", "command")}
          >
            Command
          </button>
          <button
            style={{ flex: 1 }}
            className={tweaks.dashboardVariant === "focus" ? "on" : ""}
            onClick={() => set("dashboardVariant", "focus")}
          >
            Focus
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  // localStorage-backed app screen
  const [screen, setScreenRaw] = useState(() => localStorage.getItem("coin.screen") || "lang");
  const setScreen = (s) => {
    localStorage.setItem("coin.screen", s);
    setScreenRaw(s);
  };

  // Onboarding state
  const [lang, setLang] = useState(() => localStorage.getItem("coin.lang") || "en");
  useEffect(() => {
    localStorage.setItem("coin.lang", lang);
  }, [lang]);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [pin, setPin] = useState(() => localStorage.getItem("coin.pin") || "");

  // App state
  const [route, setRouteRaw] = useState(() => localStorage.getItem("coin.route") || "dashboard");
  const setRoute = (r) => {
    localStorage.setItem("coin.route", r);
    setRouteRaw(r);
  };
  const [banks, setBanks] = useState(MOCK.banks);
  const [addBankOpen, setAddBankOpen] = useState(false);

  // Tweaks
  const [tweaks, setTweaks] = useState(TWEAK_DEFAULTS);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tweaks.darkMode ? "dark" : "light");
  }, [tweaks.darkMode]);

  // Edit mode protocol
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === "__activate_edit_mode") setTweaksOpen(true);
      else if (d.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", onMsg);
    try {
      window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    } catch (_e) {}
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const addBank = () => setAddBankOpen(true);

  const ctx = {
    banks,
    setBanks,
    categories: MOCK.categories,
    transactions: MOCK.transactions,
    insights: MOCK.insights,
    currency: tweaks.currency,
    privacy: tweaks.privacy,
    setPrivacy: (v) => setTweaks({ ...tweaks, privacy: v }),
    route,
    setRoute,
    addBank,
  };

  // ── Onboarding / lock screens ──
  if (screen === "lang" || screen === "pinSet" || screen === "pinConfirm") {
    return (
      <div className="onboard-stage">
        <OnboardingFlow
          step={screen}
          lang={lang}
          setLang={setLang}
          pin1={pin1}
          setPin1={setPin1}
          pin2={pin2}
          setPin2={setPin2}
          goto={setScreen}
          finish={(finalPin) => {
            setPin(finalPin);
            localStorage.setItem("coin.pin", finalPin);
            setScreen("app");
          }}
        />
        <TweaksPanel tweaks={tweaks} setTweaks={setTweaks} open={tweaksOpen} />
      </div>
    );
  }

  if (screen === "lock") {
    return (
      <div className="onboard-stage">
        <PinUnlockScreen
          expected={pin || "1234"}
          onUnlocked={() => setScreen("app")}
          onSwitchUser={() => {
            localStorage.removeItem("coin.pin");
            setScreen("lang");
          }}
        />
        <TweaksPanel tweaks={tweaks} setTweaks={setTweaks} open={tweaksOpen} />
      </div>
    );
  }

  // ── App ──
  const titles = {
    dashboard: { title: "Dashboard", sub: "Overview of all your accounts" },
    coach: { title: "AI Coach", sub: "Proactive insights from your money" },
    budgets: { title: "Budgets", sub: "Where your money goes" },
    transactions: { title: "Transactions", sub: "Every move across every account" },
    banks: { title: "Banks & cards", sub: "Connected accounts" },
    goals: { title: "Goals", sub: "Savings targets" },
    settings: { title: "Settings", sub: "" },
    help: { title: "Help & support", sub: "" },
  };
  const t = titles[route] || titles.dashboard;

  return (
    <div className="app-shell">
      <Sidebar route={route} setRoute={setRoute} unread={2} />
      <div className="main">
        <Topbar
          title={t.title}
          subtitle={t.sub}
          onLock={() => setScreen("lock")}
          privacy={tweaks.privacy}
          setPrivacy={(v) => setTweaks({ ...tweaks, privacy: v })}
          currency={tweaks.currency}
          setCurrency={(v) => setTweaks({ ...tweaks, currency: v })}
        />
        {route === "dashboard" && <DashboardPage ctx={ctx} variant={tweaks.dashboardVariant} />}
        {route === "coach" && <CoachPage ctx={ctx} />}
        {route === "budgets" && <BudgetsPage ctx={ctx} />}
        {route === "transactions" && <TransactionsPage ctx={ctx} />}
        {route === "banks" && (
          <div className="page">
            <div className="page-head">
              <div>
                <h1 className="display">Banks & cards</h1>
                <div className="sub">{banks.length} connected</div>
              </div>
              <button className="btn btn-primary" onClick={addBank}>
                <Icon name="plus" size={14} /> Add account
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 14,
              }}
            >
              {banks.map((b) => (
                <BankTile
                  key={b.id}
                  bank={b}
                  currency={tweaks.currency}
                  privacy={tweaks.privacy}
                  onClick={() => setRoute("transactions")}
                />
              ))}
              <AddBankTile onClick={addBank} />
            </div>
          </div>
        )}
        {(route === "goals" || route === "settings" || route === "help") && (
          <div className="page">
            <div className="page-head">
              <div>
                <h1 className="display">{t.title}</h1>
                <div className="sub">Coming soon</div>
              </div>
            </div>
            <div className="card card-pad" style={{ padding: 48, textAlign: "center" }}>
              <Icon name="hard-hat" size={36} style={{ color: "var(--text-tertiary)" }} />
              <div style={{ marginTop: 10, fontSize: 14, color: "var(--text-secondary)" }}>
                This section is under construction.
              </div>
            </div>
          </div>
        )}
      </div>

      <AddBankModal
        open={addBankOpen}
        onClose={() => setAddBankOpen(false)}
        onAdd={(b) => {
          setBanks([
            ...banks,
            {
              id: b.id,
              name: b.name,
              accountLabel: "Main",
              last4: String(Math.floor(1000 + Math.random() * 9000)),
              balance: Math.round(Math.random() * 5000 + 500),
              color: b.color,
              logoBg: b.color,
              logoText: b.name[0],
              type: "checking",
              delta: (Math.random() * 6 - 2).toFixed(1) * 1,
            },
          ]);
        }}
      />

      <TweaksPanel tweaks={tweaks} setTweaks={setTweaks} open={tweaksOpen} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

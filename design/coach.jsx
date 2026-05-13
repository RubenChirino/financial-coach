// AI Coach: daily digest feed + chat interface

function CoachHeader({ tab, setTab }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        marginBottom: 20,
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      {[
        { k: "digest", label: "Daily digest", icon: "newspaper" },
        { k: "chat", label: "Chat", icon: "message-circle" },
      ].map((t) => (
        <button
          key={t.k}
          onClick={() => setTab(t.k)}
          className="btn btn-ghost"
          style={{
            borderRadius: 0,
            padding: "10px 16px",
            borderBottom: tab === t.k ? "2px solid var(--brand-primary)" : "2px solid transparent",
            color: tab === t.k ? "var(--brand-primary)" : "var(--text-secondary)",
            background: "transparent",
          }}
        >
          <Icon name={t.icon} size={14} /> {t.label}
        </button>
      ))}
    </div>
  );
}

function DigestFeed({ insights, currency, setTab }) {
  return (
    <div>
      {/* Hero brief */}
      <div
        className="card card-pad"
        style={{
          background: "linear-gradient(135deg, #5389FF 0%, #86ADFF 60%, #FFD1DC 100%)",
          color: "#fff",
          marginBottom: 20,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -40,
            right: -40,
            width: 200,
            height: 200,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.12)",
          }}
        />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(255,255,255,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="sparkles" size={18} stroke={2.5} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  opacity: 0.85,
                }}
              >
                Your AI coach
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Daily brief · April 20</div>
            </div>
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              lineHeight: 1.3,
              letterSpacing: "-0.01em",
              maxWidth: 720,
            }}
          >
            You're 11 days into April and already tracking above your savings goal. Nice work. Three
            things to look at today:
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              marginTop: 18,
            }}
          >
            {[
              { n: "1", title: "Subscriptions", body: "Over by €32 — 3 music apps" },
              { n: "2", title: "Savings buffer", body: "€820 above BBVA buffer" },
              { n: "3", title: "Bills next week", body: "€169 across 3 bills" },
            ].map((x) => (
              <div
                key={x.n}
                style={{
                  background: "rgba(255,255,255,0.15)",
                  padding: 12,
                  borderRadius: 10,
                  backdropFilter: "blur(4px)",
                }}
              >
                <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600 }}>{x.n}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{x.title}</div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{x.body}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button
              className="btn"
              style={{ background: "#fff", color: "var(--brand-primary)" }}
              onClick={() => setTab("chat")}
            >
              <Icon name="message-circle" size={14} /> Discuss with coach
            </button>
            <button
              className="btn btn-ghost"
              style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}
            >
              <Icon name="check-circle-2" size={14} /> Mark all resolved
            </button>
          </div>
        </div>
      </div>

      {/* Insight list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {insights.map((ins) => (
          <InsightCard key={ins.id} insight={ins} currency={currency} onDismiss={() => {}} />
        ))}
      </div>

      {/* Stats strip */}
      <div className="bento" style={{ marginTop: 20 }}>
        {[
          {
            label: "Potential savings found",
            value: "€19/mo",
            icon: "piggy-bank",
            color: "#10B981",
          },
          { label: "Subscriptions tracked", value: "7", icon: "repeat", color: "#EC4899" },
          { label: "Alerts this week", value: "4", icon: "bell", color: "#F59E0B" },
          { label: "Coach confidence", value: "High", icon: "shield-check", color: "#5389FF" },
        ].map((s, i) => (
          <div key={i} className="col-3 card card-pad">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: `${s.color}22`,
                color: s.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 10,
              }}
            >
              <Icon name={s.icon} size={16} />
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {s.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em", marginTop: 2 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatUI({ currency }) {
  const initial = [
    {
      role: "ai",
      text: "Hi Ana 👋 I've reviewed your last 30 days across all 5 accounts. Your savings rate is strong at 24%. What would you like to dig into today?",
    },
  ];
  const [messages, setMessages] = useState(initial);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const streamRef = useRef(null);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [messages, typing]);

  const suggestions = [
    "Why did dining cost more this month?",
    "Can I afford a €1,200 trip to Lisbon?",
    "What subscriptions can I cancel?",
    "Set a savings goal for €10,000",
  ];

  const canned = {
    dining:
      "Your dining-out spend jumped from €198 in March to €287 in April — a 45% increase. Most of it happened across 6 weekend dinners (€168 total), plus 4 lunch deliveries from Glovo (€64). You're currently €13 under the €300 budget, but trending to €340 by month-end. Want me to suggest a Friday-dinner cap?",
    lisbon:
      "Yes — here's the math. You'll have ~€2,100 free after May's fixed costs (rent €980, utilities €130, subscriptions €80, essentials €900). A €1,200 trip would leave €900 buffer, which keeps you above your 3-month emergency floor. I'd suggest moving €1,200 from ING Orange into a separate 'Lisbon' envelope so it's ring-fenced. Want me to set that up?",
    subscriptions:
      "You have 7 active subscriptions totaling €112/mo. I found 3 opportunities:\n\n• Netflix (€14) + Apple Music (€10) + Spotify (€11) = overlap. A YouTube Premium family plan could replace 2 of them and save ~€8/mo.\n• Gym Pro (€40) hasn't been used in 23 days. Pause for 2 months?\n• Medium (€5) — last read: Feb 12. Cancel?\n\nTotal potential savings: €19/mo or €228/year.",
    goal: "Done — I've created a savings goal of €10,000 by Dec 31, 2026. At your current pace (€1,495/mo savings), you'll hit it by November 8 — 54 days ahead of target. I'll check in monthly and flag if you drift off pace. Want me to auto-transfer €800 on payday to make it automatic?",
    default:
      "Good question. Let me pull that from your data — one moment.\n\nBased on the last 30 days across all your accounts, here's what I see: your patterns look healthy overall. Savings rate is 24%, which puts you in the top tier for your income range. If you'd like, I can drill into a specific category, bank, or merchant — just ask.",
  };

  const respond = (text) => {
    const low = text.toLowerCase();
    let answer = canned.default;
    if (low.includes("dining") || low.includes("eat") || low.includes("restaurant"))
      answer = canned.dining;
    else if (
      low.includes("lisbon") ||
      low.includes("trip") ||
      low.includes("afford") ||
      low.includes("vacation")
    )
      answer = canned.lisbon;
    else if (
      low.includes("subscription") ||
      low.includes("cancel") ||
      low.includes("netflix") ||
      low.includes("spotify")
    )
      answer = canned.subscriptions;
    else if (
      low.includes("goal") ||
      low.includes("save") ||
      low.includes("10,000") ||
      low.includes("10000")
    )
      answer = canned.goal;
    return answer;
  };

  const send = (text) => {
    if (!text.trim()) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setMessages((m) => [...m, { role: "ai", text: respond(text) }]);
      setTyping(false);
    }, 900);
  };

  return (
    <div className="chat-shell">
      {/* Left: context panel */}
      <div className="chat-pane" style={{ padding: 16 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-tertiary)",
            marginBottom: 10,
          }}
        >
          Coach has context on
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { icon: "landmark", label: "5 connected accounts" },
            { icon: "arrow-left-right", label: "248 transactions (90 days)" },
            { icon: "pie-chart", label: "9 categories & budgets" },
            { icon: "target", label: "2 savings goals" },
            { icon: "repeat", label: "7 subscriptions" },
          ].map((x, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                background: "var(--surface-app)",
                borderRadius: 8,
              }}
            >
              <Icon name={x.icon} size={14} style={{ color: "var(--text-secondary)" }} />
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{x.label}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-tertiary)",
            margin: "20px 0 10px",
          }}
        >
          Try asking
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {suggestions.map((s) => (
            <button
              key={s}
              className="suggestion-chip"
              style={{ textAlign: "left", borderRadius: 8 }}
              onClick={() => send(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div
          style={{
            marginTop: "auto",
            paddingTop: 16,
            fontSize: 11,
            color: "var(--text-tertiary)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="shield-check" size={12} /> End-to-end encrypted · Never shared
        </div>
      </div>

      {/* Right: chat stream */}
      <div className="chat-pane">
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-default)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              background: "linear-gradient(135deg, #5389FF, #FFD1DC)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <Icon name="sparkles" size={16} stroke={2.5} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Coach</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#10B981" }} />{" "}
              Online · analyzing your accounts
            </div>
          </div>
        </div>

        <div className="chat-stream" ref={streamRef}>
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === "ai" && (
                <div className="ai-avatar">
                  <Icon name="sparkles" size={14} stroke={2.5} />
                </div>
              )}
              <div className="bubble" style={{ whiteSpace: "pre-wrap" }}>
                {m.text}
              </div>
            </div>
          ))}
          {typing && (
            <div className="msg ai">
              <div className="ai-avatar">
                <Icon name="sparkles" size={14} stroke={2.5} />
              </div>
              <div className="bubble" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span className="dot1" style={{ animation: "blink 1.2s infinite" }}>
                  ●
                </span>
                <span style={{ animation: "blink 1.2s infinite 0.2s" }}>●</span>
                <span style={{ animation: "blink 1.2s infinite 0.4s" }}>●</span>
              </div>
            </div>
          )}
        </div>

        <div className="chat-input-wrap">
          <button className="icon-btn" title="Attach">
            <Icon name="paperclip" size={16} />
          </button>
          <input
            className="chat-input"
            placeholder="Ask about a payment, bank, budget… e.g. 'Can I afford a €600 flight?'"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send(input);
            }}
          />
          <button className="btn btn-primary" onClick={() => send(input)} disabled={!input.trim()}>
            <Icon name="send" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function CoachPage({ ctx }) {
  const [tab, setTab] = useState("digest");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "linear-gradient(135deg, #5389FF, #FFD1DC)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <Icon name="sparkles" size={20} stroke={2.5} />
            </span>
            Coach
          </h1>
          <div className="sub">
            Proactive insights and a chat that remembers every transaction you've ever made.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-outline">
            <Icon name="sliders" size={14} /> Preferences
          </button>
          <button className="btn btn-outline">
            <Icon name="history" size={14} /> History
          </button>
        </div>
      </div>

      <CoachHeader tab={tab} setTab={setTab} />
      {tab === "digest" ? (
        <DigestFeed insights={ctx.insights} currency={ctx.currency} setTab={setTab} />
      ) : (
        <ChatUI currency={ctx.currency} />
      )}

      <style>{"@keyframes blink { 0%, 100% { opacity: 0.3 } 50% { opacity: 1 } }"}</style>
    </div>
  );
}

Object.assign(window, { CoachPage });

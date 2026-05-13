// Onboarding flow: Language → PIN set → PIN confirm
// And: PIN unlock screen for returning users

function OnboardingBrand() {
  return (
    <div className="onboard-brand">
      <div className="mark">
        <Icon name="sparkles" size={20} stroke={2.5} />
      </div>
      <div>
        <div className="name">Coin</div>
        <div className="tag">AI Financial Coach</div>
      </div>
    </div>
  );
}

function Steps({ step, total = 3 }) {
  return (
    <div className="onboard-steps">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`onboard-step ${i === step ? "active" : i < step ? "done" : ""}`} />
      ))}
    </div>
  );
}

function LanguageScreen({ lang, setLang, onNext }) {
  const opts = [
    { code: "en", flag: "🇬🇧", title: "English", sub: "United Kingdom / United States" },
    { code: "es", flag: "🇪🇸", title: "Español", sub: "España / Latinoamérica" },
  ];
  return (
    <div className="onboard-card">
      <OnboardingBrand />
      <Steps step={0} />
      <h1>Welcome to Coin</h1>
      <p className="lead">
        Let's personalize your experience. Which language feels most natural to you?
      </p>

      <div style={{ marginTop: 8 }}>
        {opts.map((o) => (
          <button
            key={o.code}
            className={`lang-option${lang === o.code ? " selected" : ""}`}
            onClick={() => setLang(o.code)}
          >
            <div className="lang-flag">{o.flag}</div>
            <div>
              <div className="title">{o.title}</div>
              <div className="sub">{o.sub}</div>
            </div>
            <div className="check">
              <Icon name="check" size={12} stroke={3} />
            </div>
          </button>
        ))}
      </div>

      <button
        className="btn btn-primary btn-lg"
        style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
        onClick={onNext}
      >
        Continue <Icon name="arrow-right" size={15} />
      </button>

      <div className="caption" style={{ textAlign: "center", marginTop: 14 }}>
        You can change this anytime in Settings.
      </div>
    </div>
  );
}

function PinPad({ onKey, onDelete, onBiometric }) {
  return (
    <div className="pin-pad">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
        <button key={n} className="pin-key" onClick={() => onKey(n)}>
          {n}
        </button>
      ))}
      {onBiometric ? (
        <button className="pin-key pin-action" onClick={onBiometric} title="Face ID">
          <Icon name="scan-face" size={20} />
        </button>
      ) : (
        <div />
      )}
      <button className="pin-key" onClick={() => onKey(0)}>
        0
      </button>
      <button className="pin-key pin-action" onClick={onDelete}>
        <Icon name="delete" size={20} />
      </button>
    </div>
  );
}

function PinDots({ length, error }) {
  return (
    <div className="pin-display">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`pin-dot${i < length ? " filled" : ""}${error ? " error" : ""}`} />
      ))}
    </div>
  );
}

function PinSetScreen({ mode, pin, setPin, onNext, onBack, firstPin }) {
  // mode: 'set' or 'confirm'
  const [err, setErr] = useState("");

  const onKey = (n) => {
    if (pin.length < 4) {
      setErr("");
      const next = pin + n;
      setPin(next);
      if (next.length === 4) {
        // auto-advance
        setTimeout(() => {
          if (mode === "set") {
            onNext(next);
          } else {
            if (next === firstPin) {
              onNext(next);
            } else {
              setErr("PINs don't match. Try again.");
              setPin("");
            }
          }
        }, 200);
      }
    }
  };
  const onDelete = () => {
    setErr("");
    setPin(pin.slice(0, -1));
  };

  return (
    <div className="onboard-card">
      <OnboardingBrand />
      <Steps step={mode === "set" ? 1 : 2} />
      <h1>{mode === "set" ? "Set up your PIN" : "Confirm your PIN"}</h1>
      <p className="lead">
        {mode === "set"
          ? "Choose a 4-digit PIN. You'll use it every time you open Coin."
          : "Enter the same PIN one more time to confirm."}
      </p>

      <PinDots length={pin.length} error={!!err} />
      <div className="pin-error">{err}</div>

      <PinPad onKey={onKey} onDelete={onDelete} />

      <button
        className="btn btn-ghost"
        style={{ width: "100%", justifyContent: "center", marginTop: 16 }}
        onClick={onBack}
      >
        <Icon name="arrow-left" size={14} /> Back
      </button>
    </div>
  );
}

function PinUnlockScreen({ expected, onUnlocked, onSwitchUser }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [tries, setTries] = useState(0);

  const onKey = (n) => {
    if (pin.length < 4) {
      setErr("");
      const next = pin + n;
      setPin(next);
      if (next.length === 4) {
        setTimeout(() => {
          if (next === expected) {
            onUnlocked();
          } else {
            setErr(
              tries >= 1
                ? `Incorrect PIN. ${2 - tries} tries left.`
                : "Incorrect PIN. Please try again.",
            );
            setTries(tries + 1);
            setPin("");
          }
        }, 180);
      }
    }
  };
  const onDelete = () => {
    setErr("");
    setPin(pin.slice(0, -1));
  };

  return (
    <div className="onboard-card">
      <OnboardingBrand />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>
          AM
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Welcome back, Ana</div>
          <div className="caption">ana@example.com</div>
        </div>
      </div>

      <h1 style={{ marginTop: 20 }}>Enter your PIN</h1>
      <p className="lead">Unlock Coin to see your latest balances and insights.</p>

      <PinDots length={pin.length} error={!!err} />
      <div className="pin-error">{err}</div>

      <PinPad onKey={onKey} onDelete={onDelete} onBiometric={() => onUnlocked()} />

      <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onSwitchUser} style={{ fontSize: 12 }}>
          Forgot PIN?
        </button>
        <span style={{ color: "var(--text-tertiary)" }}>·</span>
        <button className="btn btn-ghost" onClick={onSwitchUser} style={{ fontSize: 12 }}>
          Not you?
        </button>
      </div>
    </div>
  );
}

function OnboardingFlow({ step, lang, setLang, pin1, setPin1, pin2, setPin2, goto, finish }) {
  if (step === "lang") {
    return <LanguageScreen lang={lang} setLang={setLang} onNext={() => goto("pinSet")} />;
  }
  if (step === "pinSet") {
    return (
      <PinSetScreen
        mode="set"
        pin={pin1}
        setPin={setPin1}
        onBack={() => goto("lang")}
        onNext={(_p) => {
          setPin2("");
          goto("pinConfirm");
        }}
      />
    );
  }
  if (step === "pinConfirm") {
    return (
      <PinSetScreen
        mode="confirm"
        pin={pin2}
        setPin={setPin2}
        firstPin={pin1}
        onBack={() => {
          setPin1("");
          goto("pinSet");
        }}
        onNext={(p) => finish(p)}
      />
    );
  }
  return null;
}

Object.assign(window, { OnboardingFlow, PinUnlockScreen });

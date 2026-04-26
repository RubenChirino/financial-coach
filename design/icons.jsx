// Bank logo component (renders a square tile with the bank's brand color + mark)
// Icon helper — thin wrapper around lucide so we can retain proper sizing/stroke.

const { useEffect, useRef, useState, useMemo, useCallback } = React;

function Icon({ name, size = 16, stroke = 2, className = "", style = {} }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = "";
      const node = document.createElement("i");
      node.setAttribute("data-lucide", name);
      ref.current.appendChild(node);
      window.lucide.createIcons({
        attrs: { "stroke-width": stroke, width: size, height: size },
      });
    }
  }, [name, size, stroke]);
  return (
    <span
      ref={ref}
      className={className}
      style={{ display: "inline-flex", alignItems: "center", ...style }}
    />
  );
}

function BankLogo({ bank, size = 36 }) {
  // Simple brand-colored tile with initials/symbol
  const style = {
    width: size,
    height: size,
    borderRadius: Math.max(6, size * 0.22),
    background: bank.logoBg || bank.color,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: size * 0.32,
    letterSpacing: "-0.02em",
    flexShrink: 0,
    lineHeight: 1,
  };
  return <div style={style}>{bank.logoText || bank.name[0]}</div>;
}

function CategoryIcon({ cat, size = 32 }) {
  const style = {
    width: size,
    height: size,
    borderRadius: Math.max(6, size * 0.28),
    background: `${cat.color}22`,
    color: cat.color,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
  return (
    <div style={style}>
      <Icon name={cat.icon} size={Math.round(size * 0.52)} stroke={2} />
    </div>
  );
}

// Format currency
function fmt(n, currency = "EUR", opts = {}) {
  const sym = currency === "USD" ? "$" : "€";
  const { signed = false, round = false } = opts;
  const abs = Math.abs(n);
  const str = round
    ? Math.round(abs).toLocaleString("en-US")
    : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}${sym}${str}`;
}

Object.assign(window, { Icon, BankLogo, CategoryIcon, fmt });

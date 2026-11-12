/**
 * The topbar heading for each route, as message keys.
 *
 * The shell is rendered once by the `(app)` layout, which does not re-render
 * on client navigation and is never told which page it wraps, so the heading
 * is derived from the pathname on the client. Routes not listed show the app
 * name and tagline.
 */
export interface Heading {
  title: string;
  subtitle: string;
}

const DEFAULT: Heading = { title: "app.name", subtitle: "app.tagline" };

/** Longest prefix wins; "/" only matches itself. */
const BY_PREFIX: ReadonlyArray<readonly [string, Heading]> = [
  ["/goals", { title: "goals.title", subtitle: "goals.subtitle" }],
  ["/opportunities", { title: "opportunities.title", subtitle: "opportunities.subtitle" }],
  ["/predictions", { title: "predictions.title", subtitle: "predictions.subtitle" }],
];

/**
 * @param hasData whether the user has an account or a transaction — the
 *   dashboard greets a user with data and explains the empty state otherwise.
 */
export function headingFor(pathname: string, hasData: boolean): Heading {
  if (pathname === "/") {
    return {
      title: "dashboard.title",
      subtitle: hasData ? "dashboard.subtitleGreeting" : "dashboard.subtitle",
    };
  }
  let best: readonly [string, Heading] | undefined;
  for (const entry of BY_PREFIX) {
    const [prefix] = entry;
    const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (matches && (!best || prefix.length > best[0].length)) best = entry;
  }
  return best?.[1] ?? DEFAULT;
}

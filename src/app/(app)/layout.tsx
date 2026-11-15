import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

/**
 * Every signed-in page shares one shell. As a layout it renders once per
 * request and survives client navigation between pages, instead of being
 * rebuilt by each page. URLs are unaffected: `(app)` is a route group.
 *
 * Pages still check the session themselves: a layout and its page render in
 * parallel, so a redirect here would not stop the page's own data reads.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

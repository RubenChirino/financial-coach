import "dotenv/config";
import path from "node:path";
import { type Client, createClient } from "@libsql/client";

/**
 * One-off backfill for `users.oauth_provider` (migration 0018).
 *
 * Why this exists
 * ---------------
 * Sign-in used to match on email alone, so any supported provider asserting a
 * given address landed in that account. `oauth_provider` pins each row to the
 * provider that created it — but rows that predate the column are NULL, and the
 * signIn callback treats NULL as "unclaimed": it accepts the first provider it
 * sees and stamps it.
 *
 * That leaves a window, once per user, between deploy and their next sign-in.
 * Whoever signs in first claims the row — including someone who registered the
 * victim's address with a *different* provider. This script closes the window
 * by stamping the column ahead of time.
 *
 * How the provider is determined
 * ------------------------------
 * The DB never recorded it (that is the bug), so we infer from `users.image`,
 * which Auth.js populates from the OAuth profile at first sign-in. The avatar
 * host is provider-specific and not user-controllable:
 *
 *   lh3.googleusercontent.com / *.googleusercontent.com → google
 *   avatars.githubusercontent.com / *.githubusercontent.com → github
 *   graph.microsoft.com                                  → microsoft-entra-id
 *
 * Inference is deliberately conservative: anything it cannot place with
 * certainty is left alone and reported, rather than guessed. Microsoft Entra
 * commonly returns no picture at all, so those rows will usually need an
 * explicit override.
 *
 * Overrides win over inference:
 *
 *   --set you@example.com=google --set someone@else.com=github
 *
 * Usage
 * -----
 *   # dry run — prints the plan, writes nothing (default)
 *   pnpm tsx scripts/backfill-oauth-provider.ts
 *
 *   # apply
 *   pnpm tsx scripts/backfill-oauth-provider.ts --apply
 *
 *   # production (Turso)
 *   DATABASE_URL=… TURSO_AUTH_TOKEN=… \
 *     pnpm tsx scripts/backfill-oauth-provider.ts --apply
 *
 * Idempotent: every UPDATE is gated on `oauth_provider IS NULL`, so re-running
 * only ever touches rows still unclaimed. Guests and PIN-only users (no email)
 * are skipped — neither authenticates through an OAuth provider.
 */

/** Provider ids as Auth.js reports them in `account.provider`. */
const PROVIDERS = ["google", "github", "microsoft-entra-id"] as const;
type Provider = (typeof PROVIDERS)[number];

function resolveUrl(url: string): string {
  if (
    url.startsWith("libsql:") ||
    url.startsWith("file:") ||
    url.startsWith("http:") ||
    url.startsWith("https:")
  ) {
    return url;
  }
  return `file:${url}`;
}

/** Infer the provider from the avatar host, or null when it is not conclusive. */
function inferFromImage(image: string | null): Provider | null {
  if (!image) return null;
  let host: string;
  try {
    host = new URL(image).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "googleusercontent.com" || host.endsWith(".googleusercontent.com")) return "google";
  if (host === "githubusercontent.com" || host.endsWith(".githubusercontent.com")) return "github";
  if (host === "graph.microsoft.com" || host.endsWith(".graph.microsoft.com")) {
    return "microsoft-entra-id";
  }
  return null;
}

/** `--set email=provider` pairs, lower-cased, validated against PROVIDERS. */
function parseOverrides(argv: string[]): Map<string, Provider> {
  const out = new Map<string, Provider>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--set") continue;
    const pair = argv[i + 1];
    if (!pair || !pair.includes("=")) {
      throw new Error(`--set needs email=provider, got: ${pair ?? "(nothing)"}`);
    }
    const idx = pair.lastIndexOf("=");
    const email = pair.slice(0, idx).trim().toLowerCase();
    const provider = pair.slice(idx + 1).trim();
    if (!(PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error(`unknown provider "${provider}" — expected one of: ${PROVIDERS.join(", ")}`);
    }
    out.set(email, provider as Provider);
    i++;
  }
  return out;
}

interface Row {
  id: number;
  email: string;
  image: string | null;
}

async function loadUnclaimed(client: Client): Promise<Row[]> {
  const res = await client.execute(
    `SELECT id, email, image FROM users
      WHERE oauth_provider IS NULL AND email IS NOT NULL AND is_guest = 0
      ORDER BY id ASC`,
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    image: r.image == null ? null : String(r.image),
  }));
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const overrides = parseOverrides(argv);

  const dataDir = path.resolve(process.cwd(), "data");
  const rawUrl = process.env.DATABASE_URL ?? path.join(dataDir, "financial-coach.db");
  const url = resolveUrl(rawUrl);
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  const rows = await loadUnclaimed(client);
  if (rows.length === 0) {
    console.info("✓ nothing to do — no OAuth user rows with a NULL oauth_provider.");
    client.close();
    return;
  }

  console.info(`${rows.length} unclaimed OAuth user row(s) in ${url}\n`);

  const planned: { row: Row; provider: Provider; how: string }[] = [];
  const skipped: Row[] = [];
  for (const row of rows) {
    const override = overrides.get(row.email.toLowerCase());
    if (override) {
      planned.push({ row, provider: override, how: "--set" });
      continue;
    }
    const inferred = inferFromImage(row.image);
    if (inferred) {
      planned.push({ row, provider: inferred, how: "avatar host" });
      continue;
    }
    skipped.push(row);
  }

  for (const p of planned) {
    console.info(`  user ${p.row.id}  ${p.row.email}  →  ${p.provider}   (${p.how})`);
  }
  for (const s of skipped) {
    console.info(
      `  user ${s.id}  ${s.email}  →  UNDETERMINED   (image: ${s.image ?? "none"})` +
        `\n      re-run with --set ${s.email}=<${PROVIDERS.join("|")}>`,
    );
  }

  if (!apply) {
    console.info(
      `\nDry run — nothing written. ${planned.length} row(s) would be stamped, ` +
        `${skipped.length} left for you to decide.\nRe-run with --apply to write.`,
    );
    client.close();
    return;
  }

  let stamped = 0;
  for (const p of planned) {
    // Gated on IS NULL so a concurrent sign-in that already claimed the row wins
    // rather than being silently overwritten by our inference.
    const res = await client.execute({
      sql: "UPDATE users SET oauth_provider = ?, updated_at = ? WHERE id = ? AND oauth_provider IS NULL",
      args: [p.provider, Date.now(), p.row.id],
    });
    if (res.rowsAffected > 0) stamped += res.rowsAffected;
    else console.warn(`  ! user ${p.row.id} was claimed by a sign-in mid-run — left as-is`);
  }

  console.info(`\n✓ stamped ${stamped} row(s).`);
  if (skipped.length > 0) {
    console.warn(
      `! ${skipped.length} row(s) still NULL and still exposed to the first-provider-wins window.`,
    );
  }
  client.close();
}

main().catch((err) => {
  console.error("✗ backfill failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

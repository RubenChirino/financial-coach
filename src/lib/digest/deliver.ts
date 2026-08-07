import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { type Insight, users } from "@/db/schema";
import { env } from "@/lib/env";
import { listActiveInsights } from "@/lib/insights/engine";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://financial-coach-ai.vercel.app";

export interface DigestDeliverySummary {
  /** Recipients with content who we tried to email. */
  attempted: number;
  sent: number;
  /** Opted-in recipients with nothing to report. */
  skipped: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function subjectFor(language: string): string {
  return language === "es" ? "Tu resumen de Financial Coach" : "Your Financial Coach digest";
}

function renderHtml(language: string, name: string | null, rows: Insight[]): string {
  const es = language === "es";
  const greeting = es
    ? `Hola${name ? ` ${escapeHtml(name)}` : ""},`
    : `Hi${name ? ` ${escapeHtml(name)}` : ""},`;
  const intro = es ? "Esto es lo que tu coach ha detectado:" : "Here's what your coach noticed:";
  const cta = es ? "Abrir Financial Coach" : "Open Financial Coach";
  const items = rows
    .map(
      (r) => `
      <tr><td style="padding:12px 0;border-top:1px solid #e5e7eb;">
        <div style="font-weight:600;font-size:15px;color:#0f1421;">${escapeHtml(r.title)}</div>
        <div style="margin-top:4px;font-size:13px;color:#475569;line-height:1.5;">${escapeHtml(r.body)}</div>
      </td></tr>`,
    )
    .join("");

  return `<!doctype html><html><body style="margin:0;background:#eff5fe;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;padding:24px;">
          <tr><td>
            <div style="font-size:13px;color:#5389ff;font-weight:600;">Financial Coach</div>
            <p style="font-size:15px;color:#0f1421;margin:12px 0 4px;">${greeting}</p>
            <p style="font-size:13px;color:#475569;margin:0 0 8px;">${intro}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
            <a href="${SITE_URL}" style="display:inline-block;margin-top:20px;background:#5389ff;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">${cta}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

async function sendViaResend(
  apiKey: string,
  msg: { to: string; subject: string; html: string },
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: env().RESEND_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    }),
  });
  if (!res.ok) {
    throw new Error(`resend ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

/**
 * Email the insight digest to every opted-in user who has active insights.
 * Disabled (no-op) unless `RESEND_API_KEY` is configured. Insights are already
 * stored in each user's language, so no translation context is needed here.
 *
 * This is the only path that sends user-derived content off the machine, so it
 * is doubly gated: per-user `digestEmailOptIn` AND the presence of the API key.
 */
export async function deliverDigests(): Promise<DigestDeliverySummary> {
  const summary: DigestDeliverySummary = { attempted: 0, sent: 0, skipped: 0 };
  const apiKey = env().RESEND_API_KEY;
  if (!apiKey) return summary;

  const recipients = await db
    .select({ id: users.id, email: users.email, name: users.name, language: users.language })
    .from(users)
    .where(and(eq(users.digestEmailOptIn, true), eq(users.isGuest, false), isNotNull(users.email)));

  for (const u of recipients) {
    if (!u.email) continue;
    const rows = await listActiveInsights(u.id);
    if (rows.length === 0) {
      summary.skipped += 1;
      continue;
    }
    summary.attempted += 1;
    try {
      await sendViaResend(apiKey, {
        to: u.email,
        subject: subjectFor(u.language),
        html: renderHtml(u.language, u.name, rows),
      });
      summary.sent += 1;
    } catch (err) {
      console.warn("digest email failed for user", u.id, err);
    }
  }
  return summary;
}

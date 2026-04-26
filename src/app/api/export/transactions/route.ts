import { getCurrentSession } from "@/lib/auth/session";
import { guardCsrf } from "@/lib/security/csrf";
import { listTransactions } from "@/lib/transactions/list";
import { NextResponse } from "next/server";

/**
 * GET /api/export/transactions
 *
 * Returns all transactions as a UTF-8 CSV file.
 * Requires an active session.
 *
 * Columns: date, merchant, description, amount, currency, category, account, institution
 *
 * Security:
 *   - Same-origin gate: prevents a malicious site from triggering a CSV
 *     download of the user's entire transaction history into the attacker's
 *     control via `<a download>` (the file *would* land on the victim's disk,
 *     but the request itself can leak the data via response headers / timing
 *     side channels in some setups).
 *   - On unauthenticated access we return 401 JSON, not a redirect — the
 *     caller is always the browser fetching for a download, so a redirect to
 *     `/lock` would just produce a saved-as HTML file with login markup.
 */
export async function GET(req: Request): Promise<Response> {
  const csrf = guardCsrf(req);
  if (csrf) return csrf;

  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Fetch all transactions (no pagination limit for export).
  const { rows } = await listTransactions({ limit: 100_000 });

  const header = [
    "date",
    "merchant",
    "description",
    "amount_cents",
    "currency",
    "category",
    "account",
    "institution",
  ];

  const csvRows = rows.map((r) => {
    const date =
      r.bookingDate instanceof Date
        ? r.bookingDate.toISOString().slice(0, 10)
        : String(r.bookingDate).slice(0, 10);
    return [
      date,
      escapeCsv(r.merchantName ?? ""),
      escapeCsv(r.rawDescription),
      String(r.amountCents),
      r.currency,
      escapeCsv(r.categoryNameEn ?? ""),
      escapeCsv(r.accountName),
      escapeCsv(r.institutionName),
    ].join(",");
  });

  const body = [header.join(","), ...csvRows].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

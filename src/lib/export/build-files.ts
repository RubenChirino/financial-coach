/**
 * Client-side export file builders. The server action returns plain rows; these
 * turn them into a downloadable Blob. jsPDF (+autotable) is dynamically
 * imported so the ~350KB library is only fetched when a PDF is actually
 * requested — CSV exports and normal navigation never pay for it.
 */

import { escapeCsvCell } from "./csv-escape";

export type Tone = "pos" | "neg" | "neutral";

// Palette mirrors the app's design tokens (globals.css) so the PDF reads as
// the same product: brand blue header, dark ink, soft blue zebra rows.
const BRAND: [number, number, number] = [83, 137, 255];
const INK: [number, number, number] = [15, 20, 33];
const GRAY: [number, number, number] = [100, 116, 139];
const ROW_SOFT: [number, number, number] = [243, 247, 254];
const POS: [number, number, number] = [5, 150, 105];
const NEG: [number, number, number] = [220, 38, 38];

// ─── CSV ──────────────────────────────────────────────────────────────────────

// `;` is a delimiter for Excel in several locales, so it forces quoting too.
const escapeCsv = (value: string): string => escapeCsvCell(value, ";");

/** UTF-8 CSV with BOM (so Excel opens accents/€ correctly) and CRLF endings. */
export function buildCsv(header: string[], rows: (string | number)[][]): Blob {
  const lines = [
    header.map(escapeCsv).join(","),
    ...rows.map((r) => r.map((c) => escapeCsv(String(c))).join(",")),
  ];
  return new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export interface PdfSummaryItem {
  label: string;
  value: string;
  tone: Tone;
}

export interface PdfSpec {
  /** Document heading, e.g. "Transactions export". */
  title: string;
  /** "Jan 1, 2026 – Jun 30, 2026". */
  rangeLine: string;
  /** Accounts included, pre-joined for display. */
  accountsLine: string;
  /** "Generated Jun 30, 2026, 21:15". */
  generatedLine: string;
  /** Money in / out / net strip under the header. */
  summary: PdfSummaryItem[];
  columns: { header: string; align?: "left" | "right" }[];
  /** `tones[i]` colors cell i (amounts); undefined = default ink. */
  rows: { cells: string[]; tones?: (Tone | undefined)[] }[];
  brandName: string;
  /** Footer pagination text, e.g. (2, 5) => "Page 2 of 5". */
  pageLabel: (page: number, total: number) => string;
}

function toneColor(tone: Tone | undefined): [number, number, number] {
  if (tone === "pos") return POS;
  if (tone === "neg") return NEG;
  return INK;
}

export async function buildExportPdf(spec: PdfSpec): Promise<Blob> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const contentW = pageW - marginX * 2;

  // ── Header block ──
  let y = 52;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND);
  doc.text(spec.brandName.toUpperCase(), marginX, y);

  y += 22;
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  doc.text(spec.title, marginX, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  y += 16;
  doc.text(spec.rangeLine, marginX, y);
  y += 13;
  const accountLines = doc.splitTextToSize(spec.accountsLine, contentW);
  doc.text(accountLines, marginX, y);
  y += accountLines.length * 11 + 2;
  doc.text(spec.generatedLine, marginX, y);

  // ── Summary strip (Money in / Money out / Net) ──
  y += 22;
  const cellW = contentW / spec.summary.length;
  doc.setDrawColor(212, 230, 255);
  doc.setFillColor(243, 247, 254);
  doc.roundedRect(marginX, y - 12, contentW, 44, 6, 6, "FD");
  spec.summary.forEach((item, i) => {
    const x = marginX + i * cellW + 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(item.label.toUpperCase(), x, y + 2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...toneColor(item.tone));
    doc.text(item.value, x, y + 19);
  });
  y += 48;

  // ── Main table ──
  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX, bottom: 54 },
    head: [spec.columns.map((c) => c.header)],
    body: spec.rows.map((r) => r.cells),
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      textColor: INK,
      cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
      lineColor: [226, 238, 254],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: BRAND,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
    },
    alternateRowStyles: { fillColor: ROW_SOFT },
    columnStyles: Object.fromEntries(
      spec.columns.map((c, i) => [i, { halign: c.align ?? "left" }] as const),
    ),
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const tone = spec.rows[data.row.index]?.tones?.[data.column.index];
      if (tone) data.cell.styles.textColor = toneColor(tone);
    },
  });

  // ── Footer on every page ──
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 238, 254);
    doc.line(marginX, pageH - 40, pageW - marginX, pageH - 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(`${spec.brandName} · ${spec.generatedLine}`, marginX, pageH - 28);
    doc.text(spec.pageLabel(p, total), pageW - marginX, pageH - 28, { align: "right" });
  }

  return doc.output("blob");
}

/** Trigger a browser download for a built Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

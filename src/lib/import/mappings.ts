import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { importMappings } from "@/db/schema";
import { CsvMappingSchema, type CsvMappingSpec, splitRow } from "./ai-mapper";

/** Lines searched for a remembered header: banks put 0–3 metadata lines above it. */
const HEADER_SCAN_LINES = 15;

/**
 * Identity of a CSV format: its header row, split on the mapping's delimiter,
 * cells trimmed and lower-cased. Metadata lines above it (account holder, date
 * range) may differ between exports; the header row of one bank's export does
 * not.
 */
export function headerKey(line: string, delimiter: string): string {
  const cells = splitRow(line, delimiter).map((c) => c.trim().toLowerCase());
  return createHash("sha256")
    .update(`${delimiter}\n${cells.join("\u001f")}`)
    .digest("hex");
}

const DELIMITERS = [",", ";", "\t", "|"] as const;

export interface RememberedMapping {
  spec: CsvMappingSpec;
  provider: string;
  model: string;
}

/**
 * The mapping remembered for this file's format, with `headerLineIndex` moved
 * to where the header row is in THIS file — or null. One query for every
 * candidate line × delimiter.
 */
export async function findRememberedMapping(
  userId: number,
  text: string,
): Promise<RememberedMapping | null> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).slice(0, HEADER_SCAN_LINES);
  const candidates = new Map<string, number>(); // key → raw line index (first wins)
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    for (const d of DELIMITERS) {
      const key = headerKey(line, d);
      if (!candidates.has(key)) candidates.set(key, index);
    }
  });
  if (candidates.size === 0) return null;

  const rows = await db
    .select()
    .from(importMappings)
    .where(
      and(
        eq(importMappings.userId, userId),
        inArray(importMappings.headerHash, [...candidates.keys()]),
      ),
    );
  // The earliest matching line is the header.
  const best = rows
    .map((r) => ({ r, index: candidates.get(r.headerHash) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.index - b.index)[0];
  if (!best) return null;
  const parsed = CsvMappingSchema.safeParse(JSON.parse(best.r.spec));
  if (!parsed.success) return null; // a spec from an older schema: infer again
  return {
    spec: { ...parsed.data, headerLineIndex: best.index },
    provider: best.r.provider,
    model: best.r.model,
  };
}

/** Remember a mapping that parsed this file, keyed by its header row. */
export async function rememberMapping(
  userId: number,
  text: string,
  mapping: RememberedMapping,
): Promise<void> {
  const header = text.replace(/^﻿/, "").split(/\r?\n/)[mapping.spec.headerLineIndex];
  if (!header?.trim()) return;
  const now = new Date();
  await db
    .insert(importMappings)
    .values({
      userId,
      headerHash: headerKey(header, mapping.spec.delimiter),
      spec: JSON.stringify(mapping.spec),
      provider: mapping.provider,
      model: mapping.model,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [importMappings.userId, importMappings.headerHash],
      set: {
        spec: sql`excluded.spec`,
        provider: sql`excluded.provider`,
        model: sql`excluded.model`,
        updatedAt: now,
      },
    });
}

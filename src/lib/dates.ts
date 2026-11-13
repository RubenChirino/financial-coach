/** A calendar month in UTC: `[start, end)` and its `YYYY-MM` label. */
export interface MonthRange {
  start: Date;
  end: Date;
  label: string;
}

/**
 * The month `offset` months from the current one (0 = this month, -1 = the
 * previous). UTC throughout, so a month never shifts around DST or with the
 * server's timezone.
 */
export function monthRange(offset = 0, now: Date = new Date()): MonthRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offset;
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start, end, label };
}

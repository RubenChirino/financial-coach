import "server-only";

import { db } from "@/db/client";
import { institutions } from "@/db/schema";

/**
 * Get-or-create an institution in one statement. `institutions.gocardless_id`
 * is unique, so `ON CONFLICT DO UPDATE … RETURNING` is atomic: two concurrent
 * links of the same bank can't create two rows (the old select-then-insert
 * could). The display fields are refreshed from the provider each time.
 */
export async function upsertInstitution(values: {
  gocardlessId: string;
  name: string;
  logoUrl: string | null;
  country: string;
}): Promise<number> {
  const [row] = await db
    .insert(institutions)
    .values(values)
    .onConflictDoUpdate({
      target: institutions.gocardlessId,
      set: { name: values.name, logoUrl: values.logoUrl, country: values.country },
    })
    .returning({ id: institutions.id });
  if (!row) throw new Error("failed to upsert institution");
  return row.id;
}

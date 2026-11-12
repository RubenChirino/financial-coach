import { HEADING_KEYS } from "@/components/shell/headings";

/**
 * The messages client components read, as dotted paths into the catalog: a
 * namespace (`"bank"`) or a single key (`"app.name"`). The root layout hands
 * the client only these, instead of the whole catalog on every page load.
 * `client-messages.test.ts` fails when a client component starts using a
 * namespace that is not listed here.
 */
export const CLIENT_MESSAGE_PATHS: readonly string[] = [
  "advisor.chat",
  "bank",
  "common",
  "lock",
  "onboarding.pin",
  "predictions",
  "settings",
  "shell",
  "transactions",
  "travels",
  ...HEADING_KEYS,
];

type Catalog = { [key: string]: string | Catalog };

/** The subset of `messages` at `paths`, nested as in the original. */
export function pickMessages(messages: Catalog, paths: readonly string[]): Catalog {
  const out: Catalog = {};
  for (const path of paths) {
    const parts = path.split(".");
    let src: string | Catalog | undefined = messages;
    for (const part of parts) src = typeof src === "object" ? src[part] : undefined;
    if (src === undefined) continue;
    let dst = out;
    for (const part of parts.slice(0, -1)) {
      let next = dst[part];
      if (typeof next !== "object") {
        next = {};
        dst[part] = next;
      }
      dst = next;
    }
    dst[parts[parts.length - 1] as string] = src;
  }
  return out;
}

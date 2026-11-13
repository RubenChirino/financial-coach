import "server-only";

import { cache } from "react";
import { listActiveInsights } from "./engine";

/**
 * {@link listActiveInsights}, memoized per server render: the shell (for the
 * bell) and the page (dashboard cards, coach digest) ask for the same list in
 * one request, and the engine runs once.
 */
export const getVisibleInsights = cache((userId: number, locale: string) =>
  listActiveInsights(userId, locale),
);

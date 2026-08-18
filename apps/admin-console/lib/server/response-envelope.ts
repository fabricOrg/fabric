import "server-only";

/**
 * Re-export of the shared unwrapper.
 *
 * This module used to carry its OWN copy, which meant the admin console was internally
 * inconsistent: `app/api/admin/plugins/route.ts` imported from `@app/contracts` while every
 * `lib/server/*-client.ts` imported the local one. Two implementations of the same three-line
 * predicate is how they drift.
 *
 * The module survives only so the existing `./response-envelope` imports keep working, and because
 * this app has no shared transport — twelve client modules call `fetch` directly, which is the real
 * thing worth fixing. Folding them onto one `internalApi()` helper would retire this file.
 */
export { unwrapEnvelope } from "@app/contracts";

import type { RouteBindings } from "./route-binding.types.js";
import { INTERNAL_ADMIN_BINDINGS } from "./route-bindings/internal-admin.js";
import { INTERNAL_PLATFORM_BINDINGS } from "./route-bindings/internal-platform.js";
import { INTERNAL_PRICING_BINDINGS } from "./route-bindings/internal-pricing.js";
import { PUBLIC_ACCOUNT_BINDINGS } from "./route-bindings/public-account.js";
import { PUBLIC_MANAGED_BINDINGS } from "./route-bindings/public-managed.js";
import { PUBLIC_MESSAGING_BINDINGS } from "./route-bindings/public-messaging.js";
import { PUBLIC_MONEY_BINDINGS } from "./route-bindings/public-money.js";
import { SYSTEM_BINDINGS } from "./route-bindings/system.js";

/**
 * THE BINDING TABLE — one entry per HTTP route, split by domain to stay under the file-length
 * guard. The generator fails when a route has no entry or an entry names a route that no longer
 * exists, so this cannot quietly fall behind the router.
 *
 * WHAT GOES IN A BINDING: intent only — summary, tags, visibility, which credential opens it, and
 * WHICH CONTRACT describes the body. Never a shape. Shapes come from `@app/contracts` through
 * `z.toJSONSchema()`; re-describing one here would recreate the second source of truth this
 * pipeline exists to remove.
 *
 * VISIBILITY IS A SECURITY DECISION. `public` routes land in the published artifact. The rule
 * applied here is that visibility follows the GUARD, not the path: `ApiKeyGuard` means a customer
 * key already reaches the route, so documenting it changes nothing about its exposure, while
 * `BffTokenGuard` means only a server-side BFF can call it. `/v1` on its own means nothing —
 * several `/v1` routes are dashboard features that a key nonetheless opens, and they are marked
 * `public` because that is what the guard actually permits.
 *
 * A duplicate key across two fragments would be silently overwritten by object spread, so the
 * merge is checked: every fragment's keys must be disjoint.
 */
const FRAGMENTS: readonly RouteBindings[] = [
  PUBLIC_MESSAGING_BINDINGS,
  PUBLIC_MANAGED_BINDINGS,
  PUBLIC_ACCOUNT_BINDINGS,
  PUBLIC_MONEY_BINDINGS,
  INTERNAL_ADMIN_BINDINGS,
  INTERNAL_PRICING_BINDINGS,
  INTERNAL_PLATFORM_BINDINGS,
  SYSTEM_BINDINGS,
];

function mergeDisjoint(fragments: readonly RouteBindings[]): RouteBindings {
  const merged: Record<string, RouteBindings[string]> = {};
  const duplicates: string[] = [];
  for (const fragment of fragments) {
    for (const [key, binding] of Object.entries(fragment)) {
      if (key in merged) duplicates.push(key);
      merged[key] = binding;
    }
  }
  if (duplicates.length > 0) {
    // Throwing at module load is deliberate: a duplicate means two files disagree about a route,
    // and silently keeping the last one would document whichever import order happened to win.
    throw new Error(
      `Duplicate OpenAPI route binding(s): ${duplicates.join(", ")}. ` +
        "Each route must be described in exactly one fragment.",
    );
  }
  return merged;
}

export const ROUTE_BINDINGS: RouteBindings = mergeDisjoint(FRAGMENTS);

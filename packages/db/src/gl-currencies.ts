/**
 * The currencies Fabric transacts in.
 *
 * This duplicates the `currency` enum in `@app/contracts`, which cannot be imported here — `@app/db`
 * does not depend on it. Exported so the duplication is not left on trust:
 * `gl-chart-agreement.integration.spec.ts` asserts this list and the contract enum are the same set, so
 * a currency added to one and not the other fails a gate instead of quietly dropping every movement in
 * it out of the reconciliation.
 */
export const ENABLED_CURRENCIES = ["GHS", "NGN", "USD"] as const;

/** The same set as a SQL `IN (...)` list. Literal-safe: every value is a fixed three-letter constant. */
export const CURRENCY_LIST = `(${ENABLED_CURRENCIES.map((c) => `'${c}'`).join(", ")})`;

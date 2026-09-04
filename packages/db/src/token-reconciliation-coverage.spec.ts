import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "./ledger-invariant.js";
import { measureTokenCoverage } from "./token-reconciliation-coverage.js";

/**
 * A stub standing in for the two shapes a real connection takes here: the capability question, which
 * every role may ask, and the token-table counts, which only a capable role may. `denied` reproduces
 * what Postgres actually raises for a role holding no SELECT — the case that used to escape as an
 * exception and abort the whole scheduled money-correctness pass.
 */
function executor(options: {
  capable: boolean;
  counts?: Record<string, unknown>;
  onCounts?: () => never;
}): { db: SqlExecutor; countQueries: () => number } {
  let countQueries = 0;
  const db: SqlExecutor = {
    query: async (q: string) => {
      if (q.includes("can_read_tokens")) {
        return { rows: [{ can_read_tokens: options.capable }] };
      }
      countQueries += 1;
      if (options.onCounts) options.onCounts();
      return { rows: [options.counts ?? {}] };
    },
  };
  return { db, countQueries: () => countQueries };
}

function permissionDenied(): never {
  throw Object.assign(new Error("permission denied for table token_counters"), {
    code: "42501",
  });
}

describe("measureTokenCoverage", () => {
  it("reports counts for a capable caller", async () => {
    const { db, countQueries } = executor({
      capable: true,
      counts: { lots: "3", counters: "1", pending_holds: "2", allocations: 4 },
    });
    await expect(measureTokenCoverage(db)).resolves.toEqual({
      lots: 3,
      counters: 1,
      pendingHolds: 2,
      allocations: 4,
      canReadTokens: true,
    });
    expect(countQueries()).toBe(1);
  });

  // The regression. Before the capability gate the counts ran unconditionally, so a role without
  // SELECT raised 42501 out of this function instead of returning `canReadTokens: false`.
  it("reports blindness instead of throwing when the caller lacks SELECT", async () => {
    const { db, countQueries } = executor({
      capable: false,
      onCounts: permissionDenied,
    });
    await expect(measureTokenCoverage(db)).resolves.toEqual({
      lots: 0,
      counters: 0,
      pendingHolds: 0,
      allocations: 0,
      canReadTokens: false,
    });
    // Proves the short-circuit rather than a swallowed error: the scan is never issued at all.
    expect(countQueries()).toBe(0);
  });

  it("treats a capability probe answering anything but true as blind", async () => {
    const db: SqlExecutor = {
      query: vi.fn(async () => ({ rows: [] })),
    };
    await expect(measureTokenCoverage(db)).resolves.toMatchObject({
      canReadTokens: false,
    });
  });
});

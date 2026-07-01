import postgres from "postgres";

/**
 * RUNTIME TENANT-CONTEXT SEAM (L1) — the runtime half of RLS. The DB half (roles, FORCE RLS,
 * fail-closed policies) is in sql/0001+0002 and verified; THIS is what sets the per-request tenant
 * context so those policies actually filter. See docs/PI-1/ITERATION-WS.md L1 + PRE-IMPLEMENTATION
 * REVIEW B3/B4.
 *
 * THE ONE RULE (B3): every tenant-scoped op runs inside a transaction whose FIRST statement sets
 * `app.tenant_id`, and the set MUST be transaction-scoped. We use
 *   SELECT set_config('app.tenant_id', $1, true)      -- $1 parameterized, is_local = true
 * which is the injection-safe, transaction-scoped equivalent of `SET LOCAL app.tenant_id = '…'`:
 *   - parameterized ($1) → the tenant id is never string-interpolated → no SQL-injection surface.
 *   - is_local=true ≡ SET LOCAL → the setting lives only for THIS transaction, so under transaction
 *     pooling (PgBouncer/RDS Proxy/postgres.js pool) a pooled connection can NEVER leak one request's
 *     tenant to the next. A plain `SET` would leak (B3's highest-blast-radius risk).
 *
 * The app connects as the NON-owner `app_runtime` role (no BYPASSRLS) — so even a missing/blank
 * context fails CLOSED (policies read current_setting(...,true) → NULL → 0 rows), never open.
 */

// RFC-4122 shape check. We validate BEFORE opening the transaction so an empty/garbage tenant id is
// rejected fast — and, critically, never reaches Postgres as `''::uuid`, which would RAISE (a 500
// footgun) instead of failing closed. Fail-closed with a clean 4xx-able error is the correct edge.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when a caller passes a non-uuid tenant id. Maps to a 400 at the API boundary. */
export class InvalidTenantIdError extends Error {
  constructor(received: unknown) {
    super(
      `withTenant: tenantId must be a uuid; refusing to open a tenant context for ${JSON.stringify(
        received,
      )}`,
    );
    this.name = "InvalidTenantIdError";
  }
}

/** The non-owner pool type (postgres.js infers its own generic; alias it to avoid mismatch). */
export type AppSql = ReturnType<typeof postgres>;

/** The connection type callers run tagged-template queries on inside a tenant transaction. */
export type TenantTx = postgres.TransactionSql<Record<string, never>>;

/**
 * The tenant-context seam. `sql` is the raw non-owner pool (use sparingly, for non-tenant ops);
 * `withTenant` is the guarded entry every tenant-scoped op MUST go through. This interface is the
 * stable contract L2 (api-key guard), L3 (wallet service) and L5 (send pipeline) build against.
 */
export interface AppDb {
  readonly sql: AppSql;
  /**
   * Run `fn` inside a transaction with `app.tenant_id` set (transaction-scoped) so RLS filters
   * every query. Rejects with {@link InvalidTenantIdError} — before touching the DB — if `tenantId`
   * is not a uuid. The transaction commits when `fn` resolves and rolls back if it throws.
   */
  withTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  /** Close the pool (tests / graceful shutdown). */
  end(): Promise<void>;
}

/**
 * Build an {@link AppDb} over a NON-owner (`app_runtime`) connection URL (`DATABASE_URL_APP`).
 * A factory (not a module singleton) so tests can point it at an isolated DB and services can own
 * one instance via DI without env being read at import time.
 */
export function createAppDb(
  url: string,
  options: postgres.Options<Record<string, never>> = {},
): AppDb {
  const sql: AppSql = postgres(url, { max: 10, ...options });

  return {
    sql,
    withTenant<T>(
      tenantId: string,
      fn: (tx: TenantTx) => Promise<T>,
    ): Promise<T> {
      // Validate FIRST — before any connection/transaction — so invalid context never reaches SQL.
      if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
        return Promise.reject(new InvalidTenantIdError(tenantId));
      }
      return sql.begin(async (tx) => {
        // FIRST statement: bind the tenant, transaction-scoped + parameterized. RLS reads it as
        // current_setting('app.tenant_id', true)::uuid — the value is a canonical uuid string, so
        // the ::uuid cast in the policies matches exactly.
        await tx.unsafe("SELECT set_config('app.tenant_id', $1, true)", [
          tenantId,
        ]);
        return fn(tx as unknown as TenantTx);
      }) as Promise<T>;
    },
    end() {
      return sql.end();
    },
  };
}

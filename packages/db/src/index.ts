// @app/db public entry (the `exports` map points here). Re-exports the typed schema (source of
// truth for tables/types) and the runtime tenant-context seam. Services import from `@app/db`, never
// from deep paths, so the package boundary stays a single, stable surface.

export * from "./client.js";
export * from "./gl-invariant.js";
export * from "./ledger-invariant.js";
export * from "./pagination.js";
export * from "./pii-envelope.js";
export * from "./plugin-envelope.js";
export * from "./provisioning.js";
export * from "./queries/customer-reads.js";
export * from "./schema/index.js";

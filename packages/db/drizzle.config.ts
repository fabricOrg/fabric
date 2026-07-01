import { defineConfig } from "drizzle-kit";

// drizzle-kit reads the TYPED schema (source of truth) and:
//   - `generate` → diffs schema vs migrations and emits versioned SQL into ./migrations
//   - `migrate`  → applies pending migrations to the DB
// WHY schema-as-code: the TypeScript schema is the ONE definition; both the SQL migrations AND the
// app's types are derived from it → they can't drift (maintainability + type safety).
//
// Migrations run as the OWNER role (it creates/owns tables). The app connects as a different,
// RLS-constrained role at runtime (security — see migration 0000 + .env.example).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    // eslint-disable-next-line no-undef -- Node provides process.env
    url: process.env.DATABASE_URL_OWNER!,
  },
  strict: true,   // confirm destructive changes before applying
  verbose: true,
});

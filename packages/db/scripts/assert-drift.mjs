// ============================================================================================
// MIGRATION-DRIFT GUARD (strategy §3, "journal reproduces the applied schema") — QA / adams.
// The other half of the standing gate: db:assert proves the DB *state* is correct; THIS proves the
// migration journal is COMPLETE — i.e. `drizzle-kit generate` against the current schema produces NO
// new migration. If it wants to write one, schema/src drifted from the journal (someone edited a
// table in src/schema without generating) → a `db:migrate` on a fresh DB would NOT reproduce what the
// author is running. Fail the gate.
//
// SCOPE: drizzle only models table/column DDL, so this guards the drizzle-managed schema. The custom
// SQL migrations (RLS policies, triggers) are NOT in drizzle's snapshots — those invariants are the
// job of `db:assert:security` (FORCE RLS + policy + trigger existence). The two gates are complementary.
//
// NON-MUTATING: snapshots every file under migrations/ first, runs generate with stdin CLOSED (so
// drizzle's strict destructive-change PROMPT gets EOF and aborts instead of hanging CI), then RESTORES
// the dir byte-for-byte (deletes anything new, reverts anything changed) — pure fs, no git dependency.
//
// USAGE:  node scripts/assert-drift.mjs
// EXIT:   0 = journal reproduces schema (no drift) · 1 = drift (or generate failed)
// ============================================================================================

import { execSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const MIGRATIONS = new URL("../migrations/", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
); // strip leading slash on Windows drive paths

/** Recursively snapshot every file under a dir → Map<relpath, contents>. */
function snapshot(dir) {
  const out = new Map();
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      for (const [k, v] of snapshot(full)) out.set(k, v);
    } else {
      out.set(relative(MIGRATIONS, full), readFileSync(full));
    }
  }
  return out;
}

/** Restore the dir to `before`: delete files that appeared, rewrite any that changed/were removed. */
function restore(before, after) {
  for (const path of after.keys()) {
    if (!before.has(path)) rmSync(join(MIGRATIONS, path)); // newly generated → remove
  }
  for (const [path, contents] of before) {
    const now = after.get(path);
    if (now === undefined || !now.equals(contents)) {
      writeFileSync(join(MIGRATIONS, path), contents); // reverted / changed → restore bytes
    }
  }
}

const before = snapshot(MIGRATIONS);

try {
  // stdin 'ignore' (≡ `< /dev/null`) → drizzle's strict destructive-change PROMPT reads EOF and aborts
  // instead of hanging. We detect drift by the files generate WRITES, not its stdout, so output is dropped.
  execSync("pnpm exec drizzle-kit generate", {
    cwd: new URL("../", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
    stdio: "ignore",
  });
} catch {
  // A non-zero generate (e.g. aborted prompt) is fine — the file-diff below is the source of truth.
}

const after = snapshot(MIGRATIONS);
const newFiles = [...after.keys()].filter((p) => !before.has(p));
const changed = [...before.keys()].filter(
  (p) => after.has(p) && !after.get(p).equals(before.get(p)),
);

// Capture the drift SQL for the report BEFORE restoring.
const driftSql = newFiles
  .filter((p) => p.endsWith(".sql"))
  .map((p) => `--- ${p} ---\n${after.get(p).toString("utf8")}`)
  .join("\n");

restore(before, after);

if (newFiles.length > 0 || changed.length > 0) {
  console.error(
    "✗ migration drift: `drizzle-kit generate` wants to write a migration — src/schema is ahead of the journal.",
  );
  if (changed.length)
    console.error(`  changed journal files: ${changed.join(", ")}`);
  if (driftSql) console.error(`  un-journaled DDL:\n${driftSql}`);
  console.error(
    "\n  Fix: run `pnpm db:generate` and commit the migration, so a fresh `db:migrate` reproduces this schema.",
  );
  process.exit(1);
}

console.log(
  "✓ migration journal reproduces the schema (drizzle-kit generate emits no new migration)",
);

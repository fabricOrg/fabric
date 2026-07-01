// Browser-safe guard. @app/contracts is the ONE package the frontend bundles (zod DTOs + the F8.3
// error parser), so it must stay free of Node-only imports — a stray `node:*` / `fs` / WorkOS import
// would break the FE build or, worse, leak server-only code (e.g. @app/fe-auth) into a client
// bundle. This fails CI if a browser-safe package imports something Node-only. Runs in `pnpm guard`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

// Packages that MUST remain importable from a browser bundle.
const browserSafePackages = ["contracts"];

// Import specifiers that are forbidden in those packages. `node:*` is caught by prefix below.
const forbiddenSpecifiers = new Set([
  "fs",
  "path",
  "crypto",
  "os",
  "child_process",
  "@workos-inc/node", // server-only auth engine — never in a browser-safe package
  "@app/fe-auth", // server-only session module — never re-exported from contracts
  "@app/db", // server-only DB layer
]);

const importRe =
  /\bimport\s+(?:[\s\S]*?)\s+from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g;
const violations = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
    const source = readFileSync(fullPath, "utf8");
    for (const match of source.matchAll(importRe)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;
      if (specifier.startsWith("node:") || forbiddenSpecifiers.has(specifier)) {
        violations.push({ path: relative(root, fullPath), specifier });
      }
    }
  }
}

let checked = 0;
for (const pkg of browserSafePackages) {
  const srcDir = join(root, "packages", pkg, "src");
  if (!existsSync(srcDir)) continue;
  walk(srcDir);
  checked += 1;
}

if (violations.length) {
  console.error(
    [
      "Browser-safe guard failed. These packages are bundled by the frontend and must not import",
      "Node-only or server-only modules:",
      ...violations.map(
        ({ path, specifier }) => `- ${path}: imports "${specifier}"`,
      ),
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Browser-safe guard passed for ${checked} package(s).`);

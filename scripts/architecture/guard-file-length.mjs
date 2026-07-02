// File-length guard (adopted from shop-app-v2). Small files prevent architectural drift:
// when a file nears the limit you're forced to extract helpers/services/mappers — which keeps
// modules cohesive and reviewable. Runs in pre-commit and CI (`pnpm guard`).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const maxSourceLines = 300;
const maxTestLines = 350;
const violations = [];

// Resilient: derive source roots from packages/* and services/* (skip what doesn't exist yet).
function sourceRoots() {
  const roots = [];
  for (const group of ["packages", "services"]) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const pkg of readdirSync(groupDir)) {
      const srcDir = join(groupDir, pkg, "src");
      if (existsSync(srcDir)) roots.push(srcDir);
    }
  }
  return roots;
}

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      walk(fullPath);
      continue;
    }
    const ext = entry.slice(entry.lastIndexOf("."));
    if (!allowedExtensions.has(ext)) continue;

    // shadcn/ui vendored primitives (added by the CLI, re-fetched/overwritten on update) aren't
    // ours to split — a few (e.g. sidebar.tsx) legitimately exceed the limit upstream. Our own
    // components/screens live elsewhere and stay guarded.
    if (
      relative(root, fullPath).replace(/\\/g, "/").includes("/components/ui/")
    )
      continue;

    const lines = readFileSync(fullPath, "utf8").split(/\r?\n/).length;
    const isTest = /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry);
    const limit = isTest ? maxTestLines : maxSourceLines;
    if (lines > limit)
      violations.push({ lines, limit, path: relative(root, fullPath) });
  }
}

const roots = sourceRoots();
for (const dir of roots) walk(dir);

if (violations.length) {
  console.error(
    [
      "File length guard failed. Split large files before they become architectural drag.",
      ...violations.map(
        ({ lines, limit, path }) =>
          `- ${path}: ${lines} lines (limit ${limit})`,
      ),
      `Source files ≤ ${maxSourceLines} lines; test files ≤ ${maxTestLines} lines.`,
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`File length guard passed for ${roots.length} source root(s).`);

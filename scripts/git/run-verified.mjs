import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";

const DOC_EXTENSIONS = new Set([".md", ".mdx"]);

export function isDocsOnly(files) {
  return (
    files.length > 0 &&
    files.every((file) => DOC_EXTENSIONS.has(path.extname(file).toLowerCase()))
  );
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function commitExists(ref) {
  if (!ref || /^0+$/u.test(ref)) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}^{commit}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function resolveBase() {
  const configured = process.env.VERIFY_BASE_SHA?.trim();
  if (commitExists(configured)) return configured;

  const branch = git(["branch", "--show-current"]);
  if (branch !== "main" && commitExists("origin/main")) {
    return git(["merge-base", "origin/main", "HEAD"]);
  }

  return commitExists("HEAD^") ? "HEAD^" : null;
}

function changedFiles() {
  const base = resolveBase();
  if (!base) return ["<initial-commit>"];
  const output = execFileSync("git", [
    "diff",
    "--name-only",
    "-z",
    `${base}..HEAD`,
  ]);
  return output.toString("utf8").split("\0").filter(Boolean);
}

function writeClassification(docsOnly) {
  const value = `docs_only=${docsOnly}\n`;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, value);
  console.log(
    docsOnly
      ? "Documentation-only change detected."
      : "Code or configuration change detected.",
  );
}

const target = process.argv[2];

if (target === "--self-test") {
  const cases = [
    { files: ["README.md", "docs/guide.mdx"], expected: true },
    { files: ["README.md", ".github/workflows/ci.yml"], expected: false },
    { files: [], expected: false },
  ];
  for (const testCase of cases) {
    if (isDocsOnly(testCase.files) !== testCase.expected) {
      throw new Error(
        `Classification failed for: ${testCase.files.join(", ")}`,
      );
    }
  }
  console.log("Change classification self-test passed.");
  process.exit(0);
}

const files = changedFiles();
const docsOnly = isDocsOnly(files);

if (target === "--classify") {
  writeClassification(docsOnly);
  process.exit(0);
}

if (docsOnly) {
  writeClassification(true);
  console.log("Skipping build and test verification.");
  process.exit(0);
}

if (target !== "verify" && target !== "verify:full") {
  console.error("Usage: run-verified.mjs --classify|verify|verify:full");
  process.exit(2);
}

writeClassification(false);
const result = spawnSync("pnpm", [target], {
  shell: process.platform === "win32",
  stdio: "inherit",
});
process.exit(result.status ?? 1);

// Commit-message guard (adapted from shop-app-v2). Enforces Conventional Commits so history is
// readable, automatable (changelogs/releases), and scoped to the work. Runs on the commit-msg hook.
import { existsSync, readFileSync, statSync } from "node:fs";

function readHeader(input) {
  const path = input.trim();
  if (existsSync(path) && statSync(path).isFile()) {
    return readFileSync(path, "utf8").split(/\r?\n/u)[0]?.trim() ?? "";
  }
  return path;
}

const arg = process.argv[2]?.trim();
if (!arg) {
  console.error("Commit message validation requires a message file path.");
  process.exit(1);
}

const message = readHeader(arg);
// type(scope)!: subject  — scope optional, lowercase-alphanumeric-dash
const conventional =
  /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|test)(\(([a-z0-9-]+)\))?(!)?: .+/u;
const bypass = [/^Merge /u, /^Revert "/u, /^(fixup|squash)! /u];

if (bypass.some((p) => p.test(message))) process.exit(0);

if (!conventional.test(message)) {
  console.error(
    [
      `Invalid commit message: ${message || "<empty>"}`,
      "Use Conventional Commits, e.g.: feat(f5-2): add send pipeline segmentation",
      "Types: build|chore|ci|docs|feat|fix|perf|refactor|revert|test",
    ].join("\n"),
  );
  process.exit(1);
}

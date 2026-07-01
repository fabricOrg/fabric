// Branch-name guard (adapted from shop-app-v2). Enforces a consistent, ticket-referencing branch
// scheme so every change is traceable. app tickets are PI-1 feature IDs (e.g. f5-2, e3) or `ops`.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function resolveGitDir() {
  const dotGit = resolve(process.cwd(), ".git");
  const stats = statSync(dotGit);
  if (stats.isDirectory()) return dotGit;
  const pointer = readFileSync(dotGit, "utf8").trim().replace(/^gitdir:\s*/i, "");
  return resolve(dirname(dotGit), pointer);
}

function currentBranch() {
  const ghBranch = process.env.GITHUB_HEAD_REF?.trim() || process.env.GITHUB_REF_NAME?.trim();
  if (ghBranch) return ghBranch;
  const head = readFileSync(join(resolveGitDir(), "HEAD"), "utf8").trim();
  return head.startsWith("ref: ") ? head.replace("ref: refs/heads/", "") : "";
}

const branch = currentBranch();
const allowed = new Set(["dev", "develop", "main", "staging", "testing"]);
// scope = feature id (f5-2), epic (e3), or ops
const pattern = /^(feature|fix|chore|docs|refactor|test)\/((f\d+(-\d+)?)|(e\d+)|ops)-[a-z0-9-]+$/;

if (allowed.has(branch) || pattern.test(branch)) {
  console.log(`Branch name accepted: ${branch}`);
  process.exit(0);
}

console.error(
  [
    `Invalid branch name: ${branch || "<detached>"}`,
    "Use dev/staging/testing/main/develop, or a ticket branch like:",
    "  feature/f5-2-send-pipeline   fix/e3-ledger-rounding   chore/ops-ci-setup",
  ].join("\n"),
);
process.exit(1);

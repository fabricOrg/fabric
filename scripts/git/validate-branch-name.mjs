// Branch-name guard (adapted from shop-app-v2). Enforces a consistent, ticket-referencing branch
// scheme so every change is traceable. app tickets are PI-1 feature IDs (e.g. f5-2, e3) or `ops`.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function resolveGitDir() {
  const dotGit = resolve(process.cwd(), ".git");
  const stats = statSync(dotGit);
  if (stats.isDirectory()) return dotGit;
  const pointer = readFileSync(dotGit, "utf8")
    .trim()
    .replace(/^gitdir:\s*/i, "");
  return resolve(dirname(dotGit), pointer);
}

function currentBranch() {
  const ghBranch =
    process.env.GITHUB_HEAD_REF?.trim() || process.env.GITHUB_REF_NAME?.trim();
  if (ghBranch) return ghBranch;
  const head = readFileSync(join(resolveGitDir(), "HEAD"), "utf8").trim();
  return head.startsWith("ref: ") ? head.replace("ref: refs/heads/", "") : "";
}

const branch = currentBranch();
const allowed = new Set(["dev", "testing", "staging", "main"]);
// scope = feature id (f5-2), epic (e3), GitHub issue (gh-123), or ops
const pattern =
  /^(feature|fix|chore|ci|docs|refactor|test|build|perf)\/((f\d+(-\d+)?)|(e\d+)|(gh-\d+)|ops)-[a-z0-9-]+$/;
const automated = /^dependabot\/(npm_and_yarn|github_actions)\/[a-z0-9._/-]+$/;

if (allowed.has(branch) || pattern.test(branch) || automated.test(branch)) {
  console.log(`Branch name accepted: ${branch}`);
  process.exit(0);
}

console.error(
  [
    `Invalid branch name: ${branch || "<detached>"}`,
    "Use a long-lived promotion branch, or a short-lived work branch like:",
    "  feature/f5-2-send-pipeline   fix/gh-123-webhook-hmac   ci/ops-cache",
  ].join("\n"),
);
process.exit(1);

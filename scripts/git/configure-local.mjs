import { spawnSync } from "node:child_process";

const settings = [
  ["pull.ff", "only"],
  ["fetch.prune", "true"],
  ["push.autoSetupRemote", "true"],
  ["rerere.enabled", "true"],
  ["rebase.autoStash", "true"],
];

for (const [key, value] of settings) {
  const result = spawnSync("git", ["config", "--local", key, value], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("Local Git workflow configured.");

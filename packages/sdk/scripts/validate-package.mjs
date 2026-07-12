import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const temporaryDirectory = await mkdtemp(join(tmpdir(), "fabric-sdk-package-"));

try {
  run(pnpm, ["pack", "--pack-destination", temporaryDirectory]);
  const tarball = join(
    temporaryDirectory,
    "fabric-messaging-sdk-0.1.0-beta.1.tgz",
  );
  const consumer = join(temporaryDirectory, "consumer.mjs");
  await writeFile(
    join(temporaryDirectory, "package.json"),
    JSON.stringify({ private: true }),
  );
  run(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    {
      cwd: temporaryDirectory,
    },
  );
  const installedManifest = JSON.parse(
    await readFile(
      join(
        temporaryDirectory,
        "node_modules",
        "@fabric-messaging",
        "sdk",
        "package.json",
      ),
      "utf8",
    ),
  );
  if (installedManifest.version !== "0.1.0-beta.1") {
    throw new Error(
      "The installed SDK version does not match the release candidate.",
    );
  }
  await writeFile(
    consumer,
    [
      'import { Fabric, WebhookVerificationError } from "@fabric-messaging/sdk";',
      'const client = new Fabric({ apiKey: "sk_test_package_smoke" });',
      'if (client.environment !== "sandbox") throw new Error("bad environment");',
      'if (typeof WebhookVerificationError !== "function") throw new Error("missing export");',
      'console.log("Installed package ESM smoke passed.");',
    ].join("\n"),
  );
  run(process.execPath, [consumer], { cwd: temporaryDirectory });
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}.`,
    );
  }
}

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const temporaryDirectory = await mkdtemp(join(tmpdir(), "fabric-sdk-package-"));
const releaseManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const releaseVersion = String(releaseManifest.version);

await assertPlaygroundIsCurrent();

try {
  run(pnpm, ["pack", "--pack-destination", temporaryDirectory]);
  const tarball = join(
    temporaryDirectory,
    `fabric-messaging-sdk-${releaseVersion}.tgz`,
  );
  const consumer = join(temporaryDirectory, "consumer.mjs");
  const commonJsConsumer = join(temporaryDirectory, "consumer.cjs");
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
  if (installedManifest.version !== releaseVersion) {
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
  // Frameworks commonly enable the `development` export condition. The published package must
  // never resolve that condition to workspace-only source files excluded from the tarball.
  run(process.execPath, ["--conditions=development", consumer], {
    cwd: temporaryDirectory,
  });
  await writeFile(
    commonJsConsumer,
    [
      'const { Fabric } = require("@fabric-messaging/sdk");',
      'if (new Fabric({ apiKey: "sk_test_package_smoke" }).environment !== "sandbox") throw new Error("bad CommonJS import");',
      'console.log("Installed package CommonJS smoke passed.");',
    ].join("\n"),
  );
  run(process.execPath, [commonJsConsumer], { cwd: temporaryDirectory });
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

/**
 * The playground vendors a packed SDK under a STABLE filename, so a stale tarball is invisible in a
 * diff and in a directory listing alike — it went three releases out of date before anyone noticed,
 * while `examples/sdk-playground` was still deployed as a demonstration of the SDK. `pnpm
 * playground:refresh` is the fix and nothing forced it, so this asserts the result of running it
 * rather than trusting a release checklist.
 */
async function assertPlaygroundIsCurrent() {
  const lockPath = new URL(
    "../../../examples/sdk-playground/package-lock.json",
    import.meta.url,
  );
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const vendored =
    lock.packages?.["node_modules/@fabric-messaging/sdk"]?.version;
  if (vendored === releaseVersion) return;
  throw new Error(
    [
      `examples/sdk-playground vendors SDK ${vendored ?? "an unrecorded version"}, but this release is ${releaseVersion}.`,
      "Run `pnpm --filter @fabric-messaging/sdk playground:refresh` and commit vendor/fabric-messaging-sdk.tgz with the lockfile.",
    ].join("\n"),
  );
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

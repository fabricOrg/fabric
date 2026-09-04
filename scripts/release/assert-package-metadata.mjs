import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Release metadata a smoke test CANNOT catch, because both defects go green on the release machine.
 *
 * The README ships inside the tarball, so a stale version line there is what npm renders on the
 * package page — `@fabric-messaging/sdk` was one commit from publishing 0.1.0-beta.8 under a banner
 * reading "Public prerelease: 0.1.0-beta.7".
 *
 * And an ESM-only package that offers a CommonJS entry (`exports["."].require`, or the legacy
 * top-level `main`) is only loadable by `require()` from Node 22.12, where `require(esm)` is
 * unflagged. A lower `engines.node` floor promises interop that throws ERR_REQUIRE_ESM for the
 * consumer — while the packaged CJS smoke test passes on whatever Node the release happened to run.
 *
 * Shared by every publishable package rather than living in one of them: the sibling package is
 * exactly where an unguarded copy of the same defect was found.
 *
 *   node scripts/release/assert-package-metadata.mjs <package-dir>
 */
const packageDir = resolve(process.argv[2] ?? ".");
const manifest = JSON.parse(
  await readFile(resolve(packageDir, "package.json"), "utf8"),
);
const version = String(manifest.version);
const problems = [];

await assertReadmeVersions();
assertCommonJsFloor();

if (problems.length > 0) {
  console.error(`${manifest.name} release metadata is wrong:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`${manifest.name}@${version} release metadata OK.`);

/**
 * Every full semver mentioned in the README must BE the release version. Asserting the new version
 * merely appears is what let beta.7 and beta.8 coexist: the install snippet carried the new one
 * while the banner still advertised the old.
 */
async function assertReadmeVersions() {
  let readme;
  try {
    readme = await readFile(resolve(packageDir, "README.md"), "utf8");
  } catch {
    problems.push("README.md is missing, and it ships in the tarball.");
    return;
  }
  const mentioned = new Set(
    (readme.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g) ?? []).filter(
      (found) => found !== version,
    ),
  );
  for (const stale of mentioned) {
    problems.push(
      `README.md mentions version ${stale}; this release is ${version}.`,
    );
  }
}

/** Refuse a CommonJS entry on an ESM package unless the Node floor can actually `require()` it. */
function assertCommonJsFloor() {
  if (manifest.type !== "module") return;
  const entries = [
    manifest.exports?.["."]?.require !== undefined && 'exports["."].require',
    manifest.main !== undefined && "main",
  ].filter(Boolean);
  if (entries.length === 0) return;

  const range = String(manifest.engines?.node ?? "");
  const match = /^(>=|\^)(\d+)\.(\d+)\.?\d*$/.exec(range.trim());
  if (!match) {
    problems.push(
      `${entries.join(" and ")} ${entries.length > 1 ? "offer" : "offers"} a CommonJS entry on an ESM package, so engines.node must be a single ">=" or "^" floor of at least 22.12 (found ${range ? `"${range}"` : "nothing"}).`,
    );
    return;
  }
  const [, , major, minor] = match;
  const supportsRequireEsm =
    Number(major) > 22 || (Number(major) === 22 && Number(minor) >= 12);
  if (!supportsRequireEsm) {
    problems.push(
      `${entries.join(" and ")} ${entries.length > 1 ? "resolve" : "resolves"} an ESM artifact, so engines.node must be >=22.12 (found "${range}") — below that, require() throws ERR_REQUIRE_ESM.`,
    );
  }
}

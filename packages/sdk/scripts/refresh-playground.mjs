// Rebuild and repack the SDK into examples/sdk-playground/vendor so the example app tracks the
// workspace source. The tarball keeps a STABLE filename (fabric-messaging-sdk.tgz) so the
// playground's package.json never changes across SDK versions — re-run this script on every SDK
// release instead of hand-committing a new versioned tgz.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdkRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const playground = path.resolve(sdkRoot, "../../examples/sdk-playground");
const vendor = path.join(playground, "vendor");

execSync("pnpm build", { cwd: sdkRoot, stdio: "inherit" });
execSync(`pnpm pack --pack-destination "${vendor}"`, {
  cwd: sdkRoot,
  stdio: "inherit",
});

// Deterministic: pnpm pack names the tarball after the current package version — no directory
// scan (a lexicographic sort would misorder beta.9 vs beta.10).
const { version } = JSON.parse(
  readFileSync(path.join(sdkRoot, "package.json"), "utf8"),
);
const packed = `fabric-messaging-sdk-${version}.tgz`;
if (!existsSync(path.join(vendor, packed))) {
  throw new Error(`pnpm pack did not produce vendor/${packed}`);
}
copyFileSync(
  path.join(vendor, packed),
  path.join(vendor, "fabric-messaging-sdk.tgz"),
);
rmSync(path.join(vendor, packed));

// Re-resolve the tarball BY SPEC, not with a bare `npm install`. The vendored filename is stable
// by design, so npm sees a satisfied dependency, prints "up to date", and leaves the lockfile
// pinned to the previous version with an integrity hash that no longer matches the file on disk —
// a state that installs fine here and fails `npm ci` everywhere else.
execSync("npm install file:vendor/fabric-messaging-sdk.tgz", {
  cwd: playground,
  stdio: "inherit",
});
console.log(`Playground vendor refreshed from ${packed}.`);

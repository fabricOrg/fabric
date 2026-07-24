// Rebuild and repack the SDK into examples/sdk-playground/vendor so the example app tracks the
// workspace source. The tarball keeps a STABLE filename (fabric-messaging-sdk.tgz) so the
// playground's package.json never changes across SDK versions — re-run this script on every SDK
// release instead of hand-committing a new versioned tgz.
import { execSync } from "node:child_process";
import { copyFileSync, readdirSync, rmSync } from "node:fs";
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

const packed = readdirSync(vendor)
  .filter(
    (file) =>
      /^fabric-messaging-sdk-.+\.tgz$/.test(file) &&
      file !== "fabric-messaging-sdk.tgz",
  )
  .sort()
  .pop();
if (!packed) throw new Error("pnpm pack produced no tarball in vendor/");
copyFileSync(
  path.join(vendor, packed),
  path.join(vendor, "fabric-messaging-sdk.tgz"),
);
rmSync(path.join(vendor, packed));

execSync("npm install", { cwd: playground, stdio: "inherit" });
console.log(`Playground vendor refreshed from ${packed}.`);

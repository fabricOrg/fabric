import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const directory = await mkdtemp(join(tmpdir(), "fabric-cli-packed-"));

try {
  const packed = spawnSync(
    pnpm,
    ["pack", "--pack-destination", directory, "--silent"],
    { cwd: packageRoot, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (packed.status !== 0) throw new Error(packed.stderr || "CLI pack failed.");
  const archive = (await readdir(directory)).find((name) =>
    name.endsWith(".tgz"),
  );
  if (!archive) throw new Error("CLI archive was not created.");
  const consumer = join(directory, "consumer");
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const installed = spawnSync(
    pnpm,
    ["add", join(directory, archive), "--ignore-scripts"],
    { cwd: directory, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (installed.status !== 0) {
    throw new Error(installed.stderr || "Packed CLI install failed.");
  }
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        manifest_version: 1,
        minimum_sdk_contract_version: 1,
        minimum_cli_contract_version: 1,
        application: { id: "96b52b90-3f8c-4a98-8f23-a4db76585c67" },
        environment: {
          id: "daf33432-f40a-48ba-8fc7-cead9853ec0d",
          type: "sandbox",
        },
        compatibility_digest: "d".repeat(64),
        definitions: [],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server failed.");
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(directory, "node_modules/@fabric-messaging/cli/dist/bin.js"),
        "definitions",
        "generate",
        "--output",
        consumer,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          FABRIC_API_KEY: "sk_test_packed-smoke",
          FABRIC_BASE_URL: `http://127.0.0.1:${address.port}`,
        },
        stdio: "pipe",
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(stderr || `Packed CLI exited ${code}.`));
    });
  });
  server.close();
  const generated = await readFile(consumer, "utf8");
  if (!generated.includes("export interface FabricCatalog")) {
    throw new Error("Packed CLI did not generate its contract.");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paths, schemas } from "./openapi-definitions.mjs";

const docsOutput = fileURLToPath(
  new URL("../../../docs/api/openapi.json", import.meta.url),
);
const packageOutput = fileURLToPath(
  new URL("../openapi.json", import.meta.url),
);
const outputs = [docsOutput, packageOutput];
const document = {
  openapi: "3.1.0",
  info: {
    title: "Fabric Messaging API",
    version: "1.0.0",
    description:
      "Server-to-server messaging API. Secret keys must never be used in browsers.",
  },
  servers: [{ url: "https://d2umm5b2x22zvp.cloudfront.net" }],
  security: [{ secretKey: [] }],
  tags: [
    { name: "SMS" },
    { name: "Email" },
    { name: "Verify" },
    { name: "Wallet" },
    { name: "Sender IDs" },
    { name: "Webhooks" },
  ],
  paths,
  components: {
    securitySchemes: {
      secretKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "sk_test_… or sk_live_…",
      },
    },
    schemas,
  },
};
const serialized = format(`${JSON.stringify(document, null, 2)}\n`);

if (process.argv.includes("--check")) {
  const current = await Promise.all(
    outputs.map((output) => readFile(output, "utf8").catch(() => "")),
  );
  if (current.some((value) => value !== serialized)) {
    console.error("OpenAPI artifact is stale. Run `pnpm openapi:generate`.");
    process.exitCode = 1;
  } else {
    console.log("OpenAPI artifact is current.");
  }
} else {
  for (const output of outputs) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized);
    console.log(`Wrote ${output}`);
  }
}

function format(input) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    command,
    ["exec", "biome", "format", "--stdin-file-path", docsOutput],
    {
      input,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || "Biome formatting failed.");
  return result.stdout;
}

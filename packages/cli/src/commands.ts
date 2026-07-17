import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateCatalog } from "./generate.js";
import { parseManifest } from "./manifest.js";

const DEFAULT_BASE_URL = "https://d2umm5b2x22zvp.cloudfront.net";

export interface DefinitionCommandOptions {
  readonly apiKey: string;
  readonly output: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export async function generateDefinitions(
  options: DefinitionCommandOptions,
): Promise<{ output: string; environment: "sandbox" | "live" }> {
  const manifest = await fetchManifest(options);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, generateCatalog(manifest), "utf8");
  return { output, environment: manifest.environment.type };
}

export async function checkDefinitions(
  options: DefinitionCommandOptions,
): Promise<{ output: string; environment: "sandbox" | "live" }> {
  const manifest = await fetchManifest(options);
  const output = resolve(options.output);
  const expected = generateCatalog(manifest);
  const current = await readFile(output, "utf8").catch(() => null);
  if (current !== expected) {
    throw new Error(
      `Definition catalog drift detected for ${manifest.environment.type}. Run \`fabric definitions generate\` and commit ${options.output}.`,
    );
  }
  return { output, environment: manifest.environment.type };
}

async function fetchManifest(options: DefinitionCommandOptions) {
  const environment = keyEnvironment(options.apiKey);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const response = await (options.fetch ?? globalThis.fetch)(
    new URL("/v1/definitions/catalog", baseUrl),
    { headers: { authorization: `Bearer ${options.apiKey}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Catalog request failed (${response.status}). Check the key's definitions:read scope and ${environment} environment.`,
    );
  }
  const manifest = parseManifest(await response.json());
  if (manifest.environment.type !== environment) {
    throw new Error(
      `Catalog environment mismatch: the key is ${environment}, but the API returned ${manifest.environment.type}.`,
    );
  }
  return manifest;
}

function keyEnvironment(apiKey: string): "sandbox" | "live" {
  if (apiKey.startsWith("sk_test_")) return "sandbox";
  if (apiKey.startsWith("sk_live_")) return "live";
  throw new Error("FABRIC_API_KEY must begin with sk_test_ or sk_live_.");
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("FABRIC_BASE_URL must use HTTPS except on loopback.");
  }
  return url.toString();
}

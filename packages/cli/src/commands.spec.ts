import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDefinitions, generateDefinitions } from "./commands.js";

const directories: string[] = [];
const catalog = {
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
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("definition commands", () => {
  it("generates then verifies the same environment catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fabric-cli-"));
    directories.push(directory);
    const output = join(directory, "fabric.generated.ts");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => response(catalog));
    const options = {
      apiKey: "sk_test_not-a-real-secret",
      baseUrl: "http://localhost:3000",
      output,
      fetch,
    };
    await generateDefinitions(options);
    await expect(checkDefinitions(options)).resolves.toMatchObject({
      environment: "sandbox",
    });
    expect(await readFile(output, "utf8")).toContain(
      "export interface FabricCatalog",
    );
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "http://localhost:3000/v1/definitions/catalog",
    );
  });

  it("reports environment-specific drift and never includes the API key", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(catalog));
    const secret = "sk_test_do-not-print-this";
    await expect(
      checkDefinitions({
        apiKey: secret,
        output: "missing.generated.ts",
        fetch,
      }),
    ).rejects.toThrow(/drift detected for sandbox/);
    try {
      await checkDefinitions({ apiKey: secret, output: "missing.ts", fetch });
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(secret);
    }
  });

  it("denies a catalog from a different environment", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        ...catalog,
        environment: { ...catalog.environment, type: "live" },
      }),
    );
    await expect(
      generateDefinitions({
        apiKey: "sk_test_example",
        output: "ignored.ts",
        fetch,
      }),
    ).rejects.toThrow(/environment mismatch/);
  });
});

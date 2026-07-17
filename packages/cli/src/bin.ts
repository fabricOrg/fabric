#!/usr/bin/env node
import { checkDefinitions, generateDefinitions } from "./commands.js";

async function main() {
  const [resource, command, ...flags] = process.argv.slice(2);
  if (
    resource !== "definitions" ||
    !["generate", "check"].includes(command ?? "")
  ) {
    throw new Error(
      "Usage: fabric definitions <generate|check> [--output fabric.generated.ts]",
    );
  }
  const options = {
    apiKey: process.env.FABRIC_API_KEY ?? "",
    output: flag(flags, "--output") ?? "fabric.generated.ts",
    ...(process.env.FABRIC_BASE_URL
      ? { baseUrl: process.env.FABRIC_BASE_URL }
      : {}),
  };
  if (!options.apiKey) {
    throw new Error("Set FABRIC_API_KEY before running this command.");
  }
  const result =
    command === "generate"
      ? await generateDefinitions(options)
      : await checkDefinitions(options);
  process.stdout.write(
    `${command === "generate" ? "Generated" : "Verified"} ${result.environment} definitions at ${result.output}\n`,
  );
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Command failed.";
  process.stderr.write(
    `${message.replace(/sk_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted]")}\n`,
  );
  process.exitCode = 1;
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFINITION_COMMANDS } from "./definition-developer-setup.js";

/**
 * SDK-004 requires the dashboard's copy-paste commands to be accurate against the PACKED CLI, so
 * these assertions read the CLI's real manifest and entry point rather than restating the literals
 * from the component — a test that compared the module to itself would survive a binary rename.
 */
function cliFile(relative: string): string {
  return readFileSync(
    fileURLToPath(
      new URL(`../../../../packages/cli/${relative}`, import.meta.url),
    ),
    "utf8",
  );
}

const cliManifest = JSON.parse(cliFile("package.json")) as {
  name: string;
  bin: Record<string, string>;
};
const binaryName = Object.keys(cliManifest.bin)[0];
const commands = DEFINITION_COMMANDS.map((command) => command.value);

describe("definition developer commands", () => {
  it("installs the packages the CLI and SDK actually publish", () => {
    const install = commands[0] ?? "";
    expect(install).toContain(cliManifest.name);
    expect(install).toContain("@fabric-messaging/sdk");
  });

  it("invokes the binary name declared in the CLI manifest", () => {
    expect(binaryName).toBeTruthy();
    for (const command of commands.slice(1)) {
      expect(command).toContain(`pnpm exec ${binaryName} definitions `);
    }
  });

  it("uses only subcommands the CLI entry point accepts", () => {
    // bin.ts rejects anything outside this pair, so a renamed subcommand fails here before a user hits it.
    const entry = cliFile("src/bin.ts");
    const accepted = ["generate", "check"].filter((subcommand) =>
      entry.includes(`"${subcommand}"`),
    );
    expect(accepted).toEqual(["generate", "check"]);
    expect(
      commands.slice(1).map((command) => command.split(" ").at(-1)),
    ).toEqual(accepted);
  });
});

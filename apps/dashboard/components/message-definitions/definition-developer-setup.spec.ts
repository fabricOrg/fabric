import { describe, expect, it } from "vitest";
import { DEFINITION_COMMANDS } from "./definition-developer-setup.js";

describe("definition developer commands", () => {
  it("uses the packed CLI binary and both supported subcommands", () => {
    expect(DEFINITION_COMMANDS.map((command) => command.value)).toEqual([
      "pnpm add @fabric-messaging/sdk && pnpm add -D @fabric-messaging/cli",
      "pnpm exec fabric definitions generate",
      "pnpm exec fabric definitions check",
    ]);
  });
});

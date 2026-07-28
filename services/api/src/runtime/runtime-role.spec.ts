import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { runtimeRoleEnabled } from "./runtime-role.js";

function config(value?: string): ConfigService {
  return {
    get: () => value,
  } as unknown as ConfigService;
}

describe("runtimeRoleEnabled", () => {
  it("keeps local/default mode compatible", () => {
    expect(runtimeRoleEnabled(config(), "api")).toBe(true);
    expect(runtimeRoleEnabled(config("all"), "worker")).toBe(true);
  });

  it("enables only the selected deployment role", () => {
    expect(runtimeRoleEnabled(config("api"), "api")).toBe(true);
    expect(runtimeRoleEnabled(config("api"), "worker")).toBe(false);
    expect(runtimeRoleEnabled(config("api"), "scheduler")).toBe(false);
  });
});

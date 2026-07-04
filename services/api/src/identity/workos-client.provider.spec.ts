import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { createWorkosClient } from "./workos-client.provider.js";

describe("WorkOS client configuration", () => {
  it("allows the API to boot when optional WorkOS integration is disabled", () => {
    const client = createWorkosClient({
      get: () => undefined,
    } as unknown as ConfigService);

    expect(client).toBeTypeOf("function");
    expect(client).toThrow("WORKOS_API_KEY is required.");
  });
});

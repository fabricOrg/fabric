import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import {
  createStaffWorkosClient,
  createWorkosClient,
} from "./workos-client.provider.js";

/** Minimal ConfigService stand-in — the factories only ever call `get`. */
function config(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("WorkOS client configuration", () => {
  it("allows the API to boot when optional WorkOS integration is disabled", () => {
    const client = createWorkosClient({
      get: () => undefined,
    } as unknown as ConfigService);

    expect(client).toBeTypeOf("function");
    expect(client).toThrow("WORKOS_API_KEY is required.");
  });
});

/**
 * WorkOS API keys are scoped per AuthKit APPLICATION, and an invitation belongs to the application
 * whose key created it. Which key the staff realm uses therefore decides where a staff invitation
 * lands, and the fallback below is what keeps staff invites working before the admin application
 * has a key of its own.
 */
describe("createStaffWorkosClient", () => {
  it("falls back to the customer key when no admin key is set", () => {
    // Today's behaviour — this change is inert on merge rather than breaking staff invitations the
    // moment it lands.
    expect(() =>
      createStaffWorkosClient(config({ WORKOS_API_KEY: "sk_customer" }))(),
    ).not.toThrow();
  });

  it("prefers the admin key when one is configured", () => {
    expect(() =>
      createStaffWorkosClient(
        config({
          WORKOS_API_KEY: "sk_customer",
          WORKOS_ADMIN_API_KEY: "sk_admin",
        }),
      )(),
    ).not.toThrow();
  });

  it("treats a blank admin key as unset rather than as a key", () => {
    // A defined-but-empty env var is the classic deploy-config failure. It must not shadow the
    // working customer key and take every staff invitation down with it.
    expect(() =>
      createStaffWorkosClient(
        config({ WORKOS_API_KEY: "sk_customer", WORKOS_ADMIN_API_KEY: "   " }),
      )(),
    ).not.toThrow();
  });

  it("throws when neither key is available", () => {
    expect(() => createStaffWorkosClient(config({}))()).toThrow(
      "WORKOS_API_KEY is required.",
    );
  });
});

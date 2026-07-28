import type { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { buildSmsProviders } from "./sms-providers.js";

const logger = { log: () => undefined } as unknown as Logger;

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe("SMS provider readiness", () => {
  it("does not call the fake provider live outside tests", () => {
    const providers = buildSmsProviders(
      config({ NODE_ENV: "production", SMS_PROVIDER: "fake" }),
      logger,
    );
    expect(providers.liveReady).toBe(false);
    expect(providers.provider.slug).toBe("fake-sms");
  });

  it("requires Arkesel credentials and carrier mode", () => {
    const sandbox = buildSmsProviders(
      config({
        NODE_ENV: "production",
        SMS_PROVIDER: "arkesel",
        ARKESEL_API_KEY: "secret",
        ARKESEL_SANDBOX: "true",
      }),
      logger,
    );
    expect(sandbox.liveReady).toBe(false);

    const live = buildSmsProviders(
      config({
        NODE_ENV: "production",
        SMS_PROVIDER: "arkesel",
        ARKESEL_API_KEY: "secret",
        ARKESEL_SANDBOX: "false",
      }),
      logger,
    );
    expect(live.liveReady).toBe(true);
    expect(live.provider.slug).toBe("arkesel-sms");
  });

  // The recipient allowlist was pilot scaffolding, removed 2026-07-28 so customers can message
  // their own audiences. Live readiness now turns on credentials + carrier mode only; who may be
  // messaged is governed per-tenant by sender registration and consent, not by a platform-wide pin.
  it("is live-ready without any recipient allowlist configured", () => {
    const live = buildSmsProviders(
      config({
        NODE_ENV: "production",
        SMS_PROVIDER: "arkesel",
        ARKESEL_API_KEY: "secret",
        ARKESEL_SANDBOX: "false",
      }),
      logger,
    );
    expect(live.liveReady).toBe(true);
    expect(live.liveReadinessReason).toBeNull();
  });

  it("still refuses a placeholder API key", () => {
    const placeholder = buildSmsProviders(
      config({
        NODE_ENV: "production",
        SMS_PROVIDER: "arkesel",
        ARKESEL_API_KEY: "REPLACE_ME",
        ARKESEL_SANDBOX: "false",
      }),
      logger,
    );
    expect(placeholder.liveReady).toBe(false);
  });
});

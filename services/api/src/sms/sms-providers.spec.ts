import type { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { buildSmsProviders, isLiveRecipientAllowed } from "./sms-providers.js";

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
        SMS_LIVE_RECIPIENT_ALLOWLIST: "+233201234567",
      }),
      logger,
    );
    expect(live.liveReady).toBe(true);
    expect(live.provider.slug).toBe("arkesel-sms");
  });

  it("fails closed when the live recipient allowlist is absent or invalid", () => {
    const missing = buildSmsProviders(
      config({
        NODE_ENV: "production",
        SMS_PROVIDER: "arkesel",
        ARKESEL_API_KEY: "secret",
        ARKESEL_SANDBOX: "false",
      }),
      logger,
    );
    expect(missing.liveReady).toBe(false);
    expect(missing.liveReadinessReason).toContain("allowlist");

    const invalid = buildSmsProviders(
      config({
        NODE_ENV: "production",
        SMS_PROVIDER: "arkesel",
        ARKESEL_API_KEY: "secret",
        ARKESEL_SANDBOX: "false",
        SMS_LIVE_RECIPIENT_ALLOWLIST: "0201234567",
      }),
      logger,
    );
    expect(invalid.liveReady).toBe(false);
    expect(invalid.liveReadinessReason).toContain("invalid E.164");
  });

  it("allows only exact recipients configured for live Arkesel delivery", () => {
    const liveConfig = config({
      SMS_PROVIDER: "arkesel",
      ARKESEL_SANDBOX: "false",
      SMS_LIVE_RECIPIENT_ALLOWLIST: "+233201234567, +233501234567",
    });
    expect(isLiveRecipientAllowed(liveConfig, "+233201234567")).toBe(true);
    expect(isLiveRecipientAllowed(liveConfig, "+233501234567")).toBe(true);
    expect(isLiveRecipientAllowed(liveConfig, "+233241234567")).toBe(false);
  });
});

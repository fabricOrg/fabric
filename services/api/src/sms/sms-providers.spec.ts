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
});

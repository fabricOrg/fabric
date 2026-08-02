import { describe, expect, it } from "vitest";
import {
  modeForSecretKey,
  webhookModeMismatch,
} from "./payment-provider-resolution";

describe("payment credential mode", () => {
  it("reads the mode off the key, not the tenant", () => {
    expect(modeForSecretKey("sk_test_abc123")).toBe("sandbox");
    expect(modeForSecretKey("sk_live_abc123")).toBe("live");
    // Anything unrecognised is treated as test: the safe direction is never "live".
    expect(modeForSecretKey("")).toBe("sandbox");
  });

  it("lets a webhook settle the intent its own key created", () => {
    // The regression: the env fallback recorded the TENANT's plan mode ("live" for any paying
    // workspace) while the webhook side hardcoded "sandbox" for the very same key, so every
    // purchase made through it was unsettleable — permanently pending, money taken, no tokens.
    const key = "sk_test_abc123";
    const intentMode = modeForSecretKey(key);
    expect(webhookModeMismatch(intentMode, modeForSecretKey(key))).toBe(false);
  });

  it("still refuses a test key settling a live intent", () => {
    // The property the mismatch check exists for — test keys circulate far more freely than live
    // ones, so one must never be able to settle a live charge.
    expect(webhookModeMismatch("live", modeForSecretKey("sk_test_abc"))).toBe(
      true,
    );
    expect(
      webhookModeMismatch("sandbox", modeForSecretKey("sk_live_abc")),
    ).toBe(true);
  });

  it("exempts intents that recorded no mode at all", () => {
    expect(webhookModeMismatch(null, "live")).toBe(false);
    expect(webhookModeMismatch(null, "sandbox")).toBe(false);
  });
});

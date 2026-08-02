import type { EngineDeps, PreparedSend, SendInput } from "@app/sms-engine";
import { describe, expect, it } from "vitest";
import { dispatchSend, virtualDlrDelayMs } from "./sms-dispatch.js";

/**
 * Deps carrying nothing but a provider slug. The guard runs before the engine is called, so no
 * database, credentials or prepared row are ever touched on this path — the cast is what lets the
 * test assert the refusal without standing up an engine that must never run.
 */
function depsWithSlug(slug: string): EngineDeps {
  return { db: null, provider: { slug } } as unknown as EngineDeps;
}

const INPUT = { to: "+233200000001" } as unknown as SendInput;
const PREPARED = { messageId: "m-1" } as unknown as PreparedSend;

describe("dispatchSend test-vendor guard", () => {
  it("refuses a real vendor under vitest, naming the fix", async () => {
    // The failure this prevents cost real money: an armed live `plugin_instances` row resolves
    // inside `pnpm test:integration` exactly as it does in production.
    await expect(
      dispatchSend({
        deps: depsWithSlug("arkesel-sms"),
        virtualProvider: null as never,
        input: INPUT,
        prepared: PREPARED,
        deliveryMode: "live",
      }),
    ).rejects.toThrow(
      /refusing to dispatch through 'arkesel-sms' under vitest/,
    );
  });

  it("names the seam that should have filtered it, so the message is actionable", async () => {
    await expect(
      dispatchSend({
        deps: depsWithSlug("aws-ses"),
        virtualProvider: null as never,
        input: INPUT,
        prepared: PREPARED,
        deliveryMode: "live",
      }),
    ).rejects.toThrow(/refusedUnderTest\(\) in sms-runtime\.service\.ts/);
  });

  // The permitted side is proven end to end rather than here: `send-dlr-e2e.integration.spec.ts`
  // asserts its resolved slug is `fake-sms` and then dispatches through it successfully.

  it("delays the DLR only for the asynchronous test recipient", () => {
    expect(virtualDlrDelayMs("+233200000002")).toBe(2_000);
    expect(virtualDlrDelayMs("+233200000001")).toBe(0);
  });
});

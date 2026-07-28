import { describe, expect, it } from "vitest";
import {
  credentialModeViolation,
  smsAdapterFor,
  smsResolutionAdapterFor,
  supportedSmsVendors,
} from "./registry.js";

describe("sms vendor registry (dispatch selection)", () => {
  it("maps a vendor string onto its adapter", () => {
    expect(smsAdapterFor("arkesel")?.().slug).toBe("arkesel-sms");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(smsAdapterFor("  ArKeSeL ")?.().slug).toBe("arkesel-sms");
  });

  it("returns null for a vendor this build cannot dispatch", () => {
    expect(smsAdapterFor("hubtel")).toBeNull();
  });

  it("constructs a fresh adapter per call, never a shared instance", () => {
    const factory = smsAdapterFor("arkesel");
    expect(factory?.()).not.toBe(factory?.());
  });

  // ADR-0011: no control-plane row may route live traffic to something that fabricates success.
  it("cannot reach the fake or virtual providers by vendor name", () => {
    for (const name of ["fake", "fake-sms", "virtual-phone", "sandbox"]) {
      expect(smsAdapterFor(name)).toBeNull();
    }
  });
});

describe("sms resolution registry (settling a dispatched message)", () => {
  it("maps a recorded provider_slug onto the adapter that dispatched it", () => {
    expect(smsResolutionAdapterFor("arkesel-sms")?.().slug).toBe("arkesel-sms");
    expect(smsResolutionAdapterFor("virtual-phone")?.().slug).toBe(
      "virtual-phone",
    );
    expect(smsResolutionAdapterFor("fake-sms")?.().slug).toBe("fake-sms");
  });

  it("returns null for a slug no adapter in this build claims", () => {
    expect(smsResolutionAdapterFor("hubtel-sms")).toBeNull();
  });

  /**
   * The drift guard. The resolution map is keyed by a STRING that must equal the adapter's own
   * `slug`, because that string is what `prepare-send` stamps into `messages.provider_slug`. Rename
   * a slug without updating the key and the lookup silently returns null forever after — every
   * message from that provider then settles against the caller's fallback adapter, which is a
   * wrong-billing bug that no type check can see.
   */
  it("keys every resolution entry by the adapter's own slug", () => {
    for (const slug of ["arkesel-sms", "virtual-phone", "fake-sms"]) {
      expect(smsResolutionAdapterFor(slug)?.().slug).toBe(slug);
    }
  });

  /**
   * Dispatchable implies settleable. A vendor we can route a live send to whose slug we cannot look
   * up afterwards would strand that message's reservation: the sweeper would bill it against
   * whatever provider the control plane pointed at later, not the one that actually carried it.
   */
  it("can settle every vendor it can dispatch to", () => {
    const vendors = supportedSmsVendors();
    expect(vendors.length).toBeGreaterThan(0);
    for (const vendor of vendors) {
      const dispatched = smsAdapterFor(vendor)?.();
      expect(dispatched, `vendor '${vendor}' has no adapter`).toBeDefined();
      const slug = dispatched?.slug ?? "";
      expect(
        smsResolutionAdapterFor(slug)?.().slug,
        `vendor '${vendor}' dispatches as '${slug}' but cannot be resolved back`,
      ).toBe(slug);
    }
  });

  /**
   * The billing rules these adapters carry are the whole reason resolution is slug-keyed rather than
   * config-keyed. `billableStatuses[0]` is the threshold `resolveMessage` compares STATUS_RANK
   * against to decide commit-vs-refund, so two adapters disagreeing on it means the same message
   * resolves differently depending on which adapter is consulted. If these ever converge, the defect
   * this map exists to prevent stops being observable — re-examine this test rather than delete it.
   *
   * Fault exemptions are deliberately asserted EQUAL: today every adapter shares the same
   * PLATFORM_FAULT_CAUSES vocabulary, so `billableStatuses` is the sole differentiator. Recording
   * that keeps the next reader from assuming a difference that isn't there.
   */
  it("keeps billing rules that genuinely differ between providers", () => {
    const arkesel = smsResolutionAdapterFor("arkesel-sms")?.();
    const virtual = smsResolutionAdapterFor("virtual-phone")?.();
    expect(arkesel?.billableStatuses).toEqual(["accepted"]);
    expect(virtual?.billableStatuses).toEqual(["undelivered"]);
    expect(arkesel?.billableStatuses).not.toEqual(virtual?.billableStatuses);
    expect(virtual?.platformFaultExemptions).toEqual(
      arkesel?.platformFaultExemptions,
    );
  });
});

/**
 * A credential must AGREE with the mode of the instance holding it. Presence checks alone let
 * through the two worst configurations in the system, both of which look successful:
 *
 *   - a LIVE Arkesel instance without sandbox='false' — the provider accepts the message, never
 *     delivers it, returns `accepted`, and `billableStatuses[0]` commits the wallet reservation;
 *   - a SANDBOX Paystack instance holding sk_live_ — real charges from a test workspace.
 */
describe("credential/mode consistency", () => {
  it("refuses a live SMS credential that is still sandboxed", () => {
    expect(
      credentialModeViolation("sms", "arkesel", "live", { apiKey: "k" }),
    ).toMatch(/sandbox='false'/);
    expect(
      credentialModeViolation("sms", "arkesel", "live", {
        apiKey: "k",
        sandbox: "true",
      }),
    ).not.toBeNull();
  });

  it("accepts a live SMS credential with sandbox disabled", () => {
    expect(
      credentialModeViolation("sms", "arkesel", "live", {
        apiKey: "k",
        sandbox: "false",
      }),
    ).toBeNull();
  });

  it("refuses a sandbox SMS instance configured to reach real carriers", () => {
    expect(
      credentialModeViolation("sms", "arkesel", "sandbox", {
        apiKey: "k",
        sandbox: "false",
      }),
    ).not.toBeNull();
  });

  it("binds Paystack key prefixes to the instance mode", () => {
    expect(
      credentialModeViolation("payment", "paystack", "live", {
        secretKey: "sk_test_x",
      }),
    ).toMatch(/live secret key/);
    expect(
      credentialModeViolation("payment", "paystack", "sandbox", {
        secretKey: "sk_live_x",
      }),
    ).toMatch(/test secret key/);
    expect(
      credentialModeViolation("payment", "paystack", "live", {
        secretKey: "sk_live_x",
      }),
    ).toBeNull();
    expect(
      credentialModeViolation("payment", "paystack", "sandbox", {
        secretKey: "sk_test_x",
      }),
    ).toBeNull();
  });

  it("has no opinion about vendors it does not know", () => {
    expect(
      credentialModeViolation("sms", "hubtel", "live", { apiKey: "k" }),
    ).toBeNull();
  });
});

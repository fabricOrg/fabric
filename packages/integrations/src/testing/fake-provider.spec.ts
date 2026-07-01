// ============================================================================================
// FakeProvider unit spec (F5.1 AC) — QA / adams. PURE (no DB) → runs in the default `test` tier.
// Asserts every scenario is deterministically triggerable + B2 idempotency + parseDlr strictness.
// Target: packages/integrations/src/testing/fake-provider.spec.ts.
// ============================================================================================

import { describe, expect, it } from "vitest";
import type { Creds, NormalizedMessage } from "../plugin.js";
import {
  FakeProvider,
  FakeProviderError,
  MAGIC_MSISDNS,
} from "./fake-provider.js";

const CREDS: Creds = {};
const fake = new FakeProvider();

function msg(
  to: string,
  messageId = "11111111-1111-1111-1111-111111111111",
): NormalizedMessage {
  return {
    messageId,
    to,
    senderId: "TESTSENDER",
    body: "hi",
    encoding: "gsm7",
    segments: 1,
  };
}

describe("FakeProvider — manifest + billing declaration", () => {
  it("declares the SMS capability, commit-on-accepted, and all platform-fault exemptions", async () => {
    expect(fake.capability).toBe("sms");
    expect(fake.billableStatuses).toEqual(["accepted"]);
    expect(fake.platformFaultExemptions).toEqual([
      "internal_error",
      "suspension",
      "fraud_block",
      "geo_block",
    ]);
    expect(fake.supports({ destinationCountry: "GH" })).toBe(true);
    expect(await fake.healthCheck()).toEqual({ status: "up" });
    expect(fake.verifyWebhook({ headers: {}, rawBody: "" }, CREDS)).toBe(true);
  });
});

describe("FakeProvider — send() scenarios (magic MSISDN)", () => {
  it("accepts (commit point) on the happy default + the billable/refund magic numbers, with a provider ref", async () => {
    // Every scenario that REACHES a billable status commits at `accepted`: delivered, undelivered,
    // platform_fault (commit then refund), and no_dlr (S4 = committed-then-expired, stays billed).
    for (const to of [
      "+233201234567",
      "+999900000001",
      "+999900000002",
      "+999900000003",
      "+999900000004",
    ]) {
      const r = await fake.send(msg(to), CREDS);
      expect(r.status, `send(${to})`).toBe("accepted");
      expect(r.providerRef).toBe("fake-11111111-1111-1111-1111-111111111111");
    }
  });

  it("S6 no_ack → send returns `sending` with NO providerRef (never billable → sweeper REFUNDS at TTL)", async () => {
    const r = await fake.send(msg("+999900000006"), CREDS);
    expect(r.status).toBe("sending"); // never reaches billableStatuses[0]='accepted' → no commit
    expect(r.providerRef).toBeUndefined(); // no ack ⟺ no ref (the submission-ack invariant)
    expect(fake.dlrFor(msg("+999900000006"))).toBeNull(); // no DLR ever → sweeper resolves it
  });

  it("rejects at submit for the reject magic number (throws)", async () => {
    await expect(fake.send(msg("+999900000005"), CREDS)).rejects.toBeInstanceOf(
      FakeProviderError,
    );
  });

  it("B2: a retried send() with the same messageId returns the SAME providerRef (idempotent, no double-send)", async () => {
    const r1 = await fake.send(
      msg("+999900000001", "aaaaaaaa-0000-0000-0000-000000000009"),
      CREDS,
    );
    const r2 = await fake.send(
      msg("+999900000001", "aaaaaaaa-0000-0000-0000-000000000009"),
      CREDS,
    );
    expect(r2.providerRef).toBe(r1.providerRef);
  });
});

describe("FakeProvider — dlrFor() + parseDlr() round-trip", () => {
  it("delivered scenario → parseDlr yields a delivered canonical DLR on the send's ref", async () => {
    const m = msg("+999900000001");
    const ref = (await fake.send(m, CREDS)).providerRef;
    const dlr = fake.dlrFor(m);
    expect(dlr).not.toBeNull();
    const canonical = fake.parseDlr(dlr);
    expect(canonical.providerRef).toBe(ref);
    expect(canonical.status).toBe("delivered");
    expect(canonical.faultCause).toBeUndefined();
  });

  it("undelivered scenario → canonical undelivered (still provider-billable)", () => {
    expect(fake.parseDlr(fake.dlrFor(msg("+999900000002"))).status).toBe(
      "undelivered",
    );
  });

  it("platform_fault scenario → failed + faultCause internal_error (drives refund)", () => {
    const c = fake.parseDlr(fake.dlrFor(msg("+999900000003")));
    expect(c.status).toBe("failed");
    expect(c.faultCause).toBe("internal_error");
  });

  it("no_dlr + reject scenarios → dlrFor returns null (sweeper/never-accepted paths)", () => {
    expect(fake.dlrFor(msg("+999900000004"))).toBeNull();
    expect(fake.dlrFor(msg("+999900000005"))).toBeNull();
  });

  it("parseDlr rejects garbage + unmapped status (B1: never silently pass)", () => {
    expect(() => fake.parseDlr(null)).toThrow(FakeProviderError);
    expect(() => fake.parseDlr({ providerRef: "x" })).toThrow(
      FakeProviderError,
    );
    expect(() => fake.parseDlr({ providerRef: "x", status: "bogus" })).toThrow(
      FakeProviderError,
    );
  });
});

describe("FakeProvider — magic-number map is the documented sandbox contract", () => {
  it("exposes the scenario map so L5 + gates reference numbers by intent", () => {
    expect(Object.keys(MAGIC_MSISDNS)).toHaveLength(6);
    expect(MAGIC_MSISDNS["+999900000005"]).toBe("reject");
    expect(MAGIC_MSISDNS["+999900000006"]).toBe("no_ack");
  });
});

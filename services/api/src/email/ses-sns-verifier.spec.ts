import { describe, expect, it, vi } from "vitest";
import {
  confirmSesSnsSubscription,
  verifySesSnsEvent,
} from "./ses-sns-verifier.js";

const topicArn = "arn:aws:sns:eu-west-1:123456789012:fabric-ses-events";

function notification(overrides: Record<string, unknown> = {}) {
  return {
    Type: "Notification",
    MessageId: "sns-message-1",
    TopicArn: topicArn,
    Message: JSON.stringify({
      notificationType: "Delivery",
      mail: { messageId: "ses-message-1" },
    }),
    Timestamp: "2026-07-29T12:00:00.000Z",
    SignatureVersion: "2",
    Signature: "c2lnbmF0dXJl",
    SigningCertURL:
      "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-test.pem",
    ...overrides,
  };
}

describe("verifySesSnsEvent", () => {
  it("verifies the expected topic and maps a delivery event", async () => {
    const fetchCertificate = vi.fn(async () => "certificate");
    const verifySignature = vi.fn(() => true);

    await expect(
      verifySesSnsEvent(
        notification(),
        topicArn,
        fetchCertificate,
        verifySignature,
      ),
    ).resolves.toEqual({
      kind: "event",
      providerRef: "ses-message-1",
      status: "delivered",
    });
    expect(fetchCertificate).toHaveBeenCalledOnce();
    expect(verifySignature).toHaveBeenCalledWith(
      expect.stringContaining("TopicArn\n"),
      "c2lnbmF0dXJl",
      "2",
      "certificate",
    );
  });

  it("rejects an attacker-controlled certificate URL before fetching", async () => {
    const fetchCertificate = vi.fn(async () => "certificate");
    await expect(
      verifySesSnsEvent(
        notification({ SigningCertURL: "https://example.com/evil.pem" }),
        topicArn,
        fetchCertificate,
        () => true,
      ),
    ).rejects.toThrow("Untrusted SNS certificate URL");
    expect(fetchCertificate).not.toHaveBeenCalled();
  });

  it("authenticates a subscription confirmation and rebuilds its AWS URL", async () => {
    const subscribeUrl = new URL("https://sns.eu-west-1.amazonaws.com/");
    subscribeUrl.searchParams.set("Token", "signed-token");
    subscribeUrl.searchParams.set("Action", "ConfirmSubscription");
    subscribeUrl.searchParams.set("TopicArn", topicArn);
    const verifySignature = vi.fn(() => true);

    await expect(
      verifySesSnsEvent(
        notification({
          Type: "SubscriptionConfirmation",
          Message: "You have chosen to subscribe.",
          SubscribeURL: subscribeUrl.toString(),
          Token: "signed-token",
        }),
        topicArn,
        vi.fn(async () => "certificate"),
        verifySignature,
      ),
    ).resolves.toEqual({
      kind: "subscription_confirmation",
      confirmationUrl:
        "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A123456789012%3Afabric-ses-events&Token=signed-token",
    });
    expect(verifySignature).toHaveBeenCalledWith(
      expect.stringContaining("SubscribeURL\n"),
      "c2lnbmF0dXJl",
      "2",
      "certificate",
    );
    expect(verifySignature).toHaveBeenCalledWith(
      expect.stringContaining("Token\nsigned-token\n"),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it("rejects a signed confirmation URL that is not pinned to the configured topic", async () => {
    await expect(
      verifySesSnsEvent(
        notification({
          Type: "SubscriptionConfirmation",
          Message: "You have chosen to subscribe.",
          SubscribeURL:
            "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A123456789012%3Aother&Token=signed-token",
          Token: "signed-token",
        }),
        topicArn,
        vi.fn(async () => "certificate"),
        () => true,
      ),
    ).rejects.toThrow("Untrusted SNS confirmation URL");
  });

  it("confirms a verified subscription without following redirects", async () => {
    const fetchConfirmation = vi.fn(async () => new Response(null));
    await confirmSesSnsSubscription(
      "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription",
      fetchConfirmation,
    );
    expect(fetchConfirmation).toHaveBeenCalledWith(
      "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription",
      expect.objectContaining({ redirect: "error" }),
    );
  });
});

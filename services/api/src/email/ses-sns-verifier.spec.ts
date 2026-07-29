import { describe, expect, it, vi } from "vitest";
import { verifySesSnsEvent } from "./ses-sns-verifier.js";

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

  it("ignores subscription confirmation without following SubscribeURL", async () => {
    await expect(
      verifySesSnsEvent(
        notification({
          Type: "SubscriptionConfirmation",
          SubscribeURL: "https://sns.eu-west-1.amazonaws.com/confirm",
          Token: "token",
        }),
        topicArn,
        vi.fn(),
        vi.fn(),
      ),
    ).resolves.toBeNull();
  });
});

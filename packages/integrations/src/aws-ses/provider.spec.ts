import { describe, expect, it, vi } from "vitest";
import { AwsSesEmailProvider } from "./provider.js";

const MESSAGE = {
  messageId: "8f900e21-c1f3-4cd4-b94b-b3a37cb085b7",
  to: "recipient@example.com",
  from: "receipts@fabric.dev",
  subject: "Receipt",
  text: "Paid",
  replyTo: "support@fabric.dev",
} as const;

const CREDS = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  region: "eu-west-1",
  configurationSet: "fabric-transactional",
  fromDomain: "fabric.dev",
  sesMode: "live",
} as const;

describe("AwsSesEmailProvider", () => {
  it("maps one recipient to SES v2 and returns the SES message id", async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: "ses-123" });
    const destroy = vi.fn();
    const provider = new AwsSesEmailProvider(() => ({ send, destroy }));

    await expect(provider.send(MESSAGE, CREDS)).resolves.toEqual({
      status: "accepted",
      providerRef: "ses-123",
    });
    const command = send.mock.calls[0]?.[0];
    expect(command?.input).toMatchObject({
      FromEmailAddress: MESSAGE.from,
      Destination: { ToAddresses: [MESSAGE.to] },
      ConfigurationSetName: CREDS.configurationSet,
      EmailTags: [{ Name: "fabric_message_id", Value: MESSAGE.messageId }],
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("refuses a from address outside the configured domain without contacting SES", async () => {
    const send = vi.fn();
    const provider = new AwsSesEmailProvider(() => ({
      send,
      destroy: vi.fn(),
    }));

    await expect(
      provider.send({ ...MESSAGE, from: "spoof@other.test" }, CREDS),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "email_from_domain_not_verified",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("maps a synchronous SES rejection but rethrows transient transport faults", async () => {
    const rejected = new Error("identity missing");
    rejected.name = "MailFromDomainNotVerifiedException";
    const rejectProvider = new AwsSesEmailProvider(() => ({
      send: vi.fn().mockRejectedValue(rejected),
      destroy: vi.fn(),
    }));
    await expect(rejectProvider.send(MESSAGE, CREDS)).resolves.toMatchObject({
      status: "failed",
      errorCode: "ses_mail_from_domain_not_verified",
    });

    const transient = new Error("timeout");
    const retryProvider = new AwsSesEmailProvider(() => ({
      send: vi.fn().mockRejectedValue(transient),
      destroy: vi.fn(),
    }));
    await expect(retryProvider.send(MESSAGE, CREDS)).rejects.toThrow("timeout");
  });
});

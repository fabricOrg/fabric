import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import type {
  Creds,
  EmailProviderResult,
  EmailSenderPlugin,
  HealthState,
  NormalizedEmail,
  RequestContext,
} from "../plugin.js";

const REJECTION_NAMES = new Set([
  "AccountSuspendedException",
  "BadRequestException",
  "MailFromDomainNotVerifiedException",
  "MessageRejected",
  "NotFoundException",
  "SendingPausedException",
]);

interface SesClient {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
  destroy(): void;
}

/** AWS SES v2 adapter. It never provisions AWS resources; it only sends through preconfigured ones. */
export class AwsSesEmailProvider implements EmailSenderPlugin {
  readonly slug = "aws-ses-email";
  readonly capability = "email" as const;
  readonly version = "1.0.0";
  readonly billableStatuses = ["accepted"] as const;
  readonly configSchema = {
    type: "object",
    required: [
      "accessKeyId",
      "secretAccessKey",
      "region",
      "configurationSet",
      "fromDomain",
      "snsTopicArn",
      "sesMode",
    ],
    properties: {
      accessKeyId: { type: "string" },
      secretAccessKey: { type: "string" },
      region: { type: "string" },
      configurationSet: { type: "string" },
      fromDomain: { type: "string" },
      snsTopicArn: { type: "string" },
      sesMode: { type: "string", enum: ["sandbox", "live"] },
    },
  };

  constructor(
    private readonly clientFactory: (
      region: string,
      accessKeyId: string,
      secretAccessKey: string,
    ) => SesClient = defaultClient,
  ) {}

  supports(_context: RequestContext): boolean {
    return true;
  }

  healthCheck(): Promise<HealthState> {
    // SES has no zero-cost send-readiness probe. Identity/configuration readiness is enforced by
    // Fabric before dispatch; a real send remains the authoritative credential/provider check.
    return Promise.resolve({ status: "up" });
  }

  async send(
    message: NormalizedEmail,
    creds: Creds,
  ): Promise<EmailProviderResult> {
    const region = required(creds, "region");
    const fromDomain = required(creds, "fromDomain").toLowerCase();
    if (!addressUsesDomain(message.from, fromDomain)) {
      return {
        status: "failed",
        providerRef: message.messageId,
        errorCode: "email_from_domain_not_verified",
      };
    }
    const input: SendEmailCommandInput = {
      FromEmailAddress: message.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: {
            ...(message.text
              ? { Text: { Data: message.text, Charset: "UTF-8" } }
              : {}),
            ...(message.html
              ? { Html: { Data: message.html, Charset: "UTF-8" } }
              : {}),
          },
        },
      },
      ConfigurationSetName: required(creds, "configurationSet"),
      EmailTags: [{ Name: "fabric_message_id", Value: message.messageId }],
      ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
    };
    const client = this.clientFactory(
      region,
      required(creds, "accessKeyId"),
      required(creds, "secretAccessKey"),
    );
    try {
      const result = await client.send(new SendEmailCommand(input));
      if (!result.MessageId) throw new Error("SES accepted without MessageId.");
      return { status: "accepted", providerRef: result.MessageId };
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      if (REJECTION_NAMES.has(name)) {
        return {
          status: "failed",
          providerRef: message.messageId,
          errorCode: `ses_${toSnakeCase(name)}`,
        };
      }
      throw error;
    } finally {
      client.destroy();
    }
  }
}

function defaultClient(
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
): SesClient {
  return new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function required(creds: Creds, key: string): string {
  const value = creds[key]?.trim();
  if (!value) throw new Error(`AWS SES credential '${key}' is required.`);
  return value;
}

function addressUsesDomain(address: string, domain: string): boolean {
  return address.toLowerCase().endsWith(`@${domain}`);
}

function toSnakeCase(value: string): string {
  return value
    .replace(/Exception$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

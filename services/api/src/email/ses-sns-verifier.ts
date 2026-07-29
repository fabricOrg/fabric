import { createPublicKey, verify, X509Certificate } from "node:crypto";
import { z } from "zod";

const envelopeSchema = z.object({
  Type: z.enum([
    "Notification",
    "SubscriptionConfirmation",
    "UnsubscribeConfirmation",
  ]),
  MessageId: z.string().min(1),
  TopicArn: z.string().min(1),
  Message: z.string(),
  Timestamp: z.string().datetime(),
  SignatureVersion: z.enum(["1", "2"]),
  Signature: z.string().min(1),
  SigningCertURL: z.string().url(),
  Subject: z.string().optional(),
  SubscribeURL: z.string().url().optional(),
  Token: z.string().optional(),
});

export interface VerifiedSesEvent {
  readonly kind: "event";
  readonly providerRef: string;
  readonly status: "sent" | "delivered" | "undelivered" | "failed";
  readonly errorCode?: string;
}

export interface VerifiedSnsSubscriptionConfirmation {
  readonly kind: "subscription_confirmation";
  readonly confirmationUrl: string;
}

export type VerifiedSesSnsMessage =
  | VerifiedSesEvent
  | VerifiedSnsSubscriptionConfirmation;

type FetchCertificate = (url: string) => Promise<string>;
type VerifySignature = (
  canonical: string,
  signature: string,
  version: "1" | "2",
  certificatePem: string,
) => boolean;

export async function verifySesSnsEvent(
  body: unknown,
  expectedTopicArn: string,
  fetchCertificate: FetchCertificate = defaultFetchCertificate,
  verifySignature: VerifySignature = defaultVerifySignature,
): Promise<VerifiedSesSnsMessage | null> {
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) throw new Error("Invalid SNS envelope.");
  const envelope = parsed.data;
  if (envelope.TopicArn !== expectedTopicArn) {
    throw new Error("Unexpected SNS topic.");
  }

  const certUrl = validatedCertificateUrl(envelope.SigningCertURL);
  const pem = await fetchCertificate(certUrl);
  const authentic = verifySignature(
    canonicalMessage(envelope),
    envelope.Signature,
    envelope.SignatureVersion,
    pem,
  );
  if (!authentic) throw new Error("Invalid SNS signature.");

  if (envelope.Type === "Notification") {
    return parseSesEvent(envelope.Message);
  }
  if (envelope.Type === "SubscriptionConfirmation") {
    if (!envelope.SubscribeURL || !envelope.Token) {
      throw new Error("Invalid SNS subscription confirmation.");
    }
    return {
      kind: "subscription_confirmation",
      confirmationUrl: validatedConfirmationUrl(
        envelope.SubscribeURL,
        expectedTopicArn,
        envelope.Token,
      ),
    };
  }
  return null;
}

function validatedCertificateUrl(value: string): string {
  const url = new URL(value);
  const awsSnsHost = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/i.test(
    url.hostname,
  );
  const awsCertificate =
    /^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    !awsSnsHost ||
    !awsCertificate ||
    url.username ||
    url.password
  ) {
    throw new Error("Untrusted SNS certificate URL.");
  }
  return url.toString();
}

function canonicalMessage(envelope: z.infer<typeof envelopeSchema>): string {
  const fields: Array<[string, string | undefined]> =
    envelope.Type === "Notification"
      ? [
          ["Message", envelope.Message],
          ["MessageId", envelope.MessageId],
          ["Subject", envelope.Subject],
          ["Timestamp", envelope.Timestamp],
          ["TopicArn", envelope.TopicArn],
          ["Type", envelope.Type],
        ]
      : [
          ["Message", envelope.Message],
          ["MessageId", envelope.MessageId],
          ["SubscribeURL", envelope.SubscribeURL],
          ["Timestamp", envelope.Timestamp],
          ["Token", envelope.Token],
          ["TopicArn", envelope.TopicArn],
          ["Type", envelope.Type],
        ];
  return fields
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}\n${value}\n`)
    .join("");
}

function validatedConfirmationUrl(
  suppliedUrl: string,
  expectedTopicArn: string,
  token: string,
): string {
  const match =
    /^arn:(aws|aws-cn|aws-us-gov):sns:([a-z0-9-]+):[0-9]{12}:[A-Za-z0-9_-]+$/.exec(
      expectedTopicArn,
    );
  if (!match) throw new Error("Invalid SNS topic ARN.");
  const partition = match[1];
  const region = match[2];
  if (!partition || !region) throw new Error("Invalid SNS topic ARN.");
  const domain = partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com";
  const expectedHost = `sns.${region}.${domain}`;

  const supplied = new URL(suppliedUrl);
  const keys = [...supplied.searchParams.keys()];
  const expectedKeys = ["Action", "Token", "TopicArn"];
  const trusted =
    supplied.protocol === "https:" &&
    supplied.hostname === expectedHost &&
    supplied.port === "" &&
    supplied.pathname === "/" &&
    !supplied.username &&
    !supplied.password &&
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key)) &&
    supplied.searchParams.get("Action") === "ConfirmSubscription" &&
    supplied.searchParams.get("TopicArn") === expectedTopicArn &&
    supplied.searchParams.get("Token") === token;
  if (!trusted) throw new Error("Untrusted SNS confirmation URL.");

  // Rebuild from the configured topic rather than fetching the envelope-supplied URL.
  const confirmation = new URL(`https://${expectedHost}/`);
  confirmation.searchParams.set("Action", "ConfirmSubscription");
  confirmation.searchParams.set("TopicArn", expectedTopicArn);
  confirmation.searchParams.set("Token", token);
  return confirmation.toString();
}

function parseSesEvent(message: string): VerifiedSesEvent {
  const parsed = z
    .object({
      notificationType: z.enum([
        "Send",
        "Delivery",
        "Bounce",
        "Complaint",
        "Reject",
        "Rendering Failure",
        "DeliveryDelay",
      ]),
      mail: z.object({ messageId: z.string().min(1) }),
    })
    .parse(JSON.parse(message));
  switch (parsed.notificationType) {
    case "Delivery":
      return {
        kind: "event",
        providerRef: parsed.mail.messageId,
        status: "delivered",
      };
    case "Bounce":
      return {
        kind: "event",
        providerRef: parsed.mail.messageId,
        status: "undelivered",
        errorCode: "ses_bounce",
      };
    case "Complaint":
      return {
        kind: "event",
        providerRef: parsed.mail.messageId,
        status: "undelivered",
        errorCode: "ses_complaint",
      };
    case "Reject":
    case "Rendering Failure":
      return {
        kind: "event",
        providerRef: parsed.mail.messageId,
        status: "failed",
        errorCode: `ses_${parsed.notificationType.toLowerCase().replaceAll(" ", "_")}`,
      };
    case "Send":
    case "DeliveryDelay":
      return {
        kind: "event",
        providerRef: parsed.mail.messageId,
        status: "sent",
      };
    default:
      throw new Error("Unsupported SES event.");
  }
}

export async function confirmSesSnsSubscription(
  confirmationUrl: string,
  fetchConfirmation: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchConfirmation(confirmationUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("SNS subscription confirmation failed.");
}

async function defaultFetchCertificate(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("SNS certificate fetch failed.");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/plain")) {
    throw new Error("SNS certificate response type is invalid.");
  }
  const pem = await response.text();
  if (pem.length > 16_384) throw new Error("SNS certificate is too large.");
  return pem;
}

function defaultVerifySignature(
  canonical: string,
  signature: string,
  version: "1" | "2",
  certificatePem: string,
): boolean {
  const certificate = new X509Certificate(certificatePem);
  const algorithm = version === "2" ? "RSA-SHA256" : "RSA-SHA1";
  return verify(
    algorithm,
    Buffer.from(canonical, "utf8"),
    createPublicKey(certificate.publicKey),
    Buffer.from(signature, "base64"),
  );
}

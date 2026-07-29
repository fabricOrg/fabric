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
  readonly providerRef: string;
  readonly status: "sent" | "delivered" | "undelivered" | "failed";
  readonly errorCode?: string;
}

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
): Promise<VerifiedSesEvent | null> {
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) throw new Error("Invalid SNS envelope.");
  const envelope = parsed.data;
  if (envelope.TopicArn !== expectedTopicArn) {
    throw new Error("Unexpected SNS topic.");
  }
  if (envelope.Type !== "Notification") {
    // Subscription confirmation is deliberately not followed automatically. Staff confirm the
    // preconfigured topic during setup; the public webhook never performs an attacker-chosen GET.
    return null;
  }

  const certUrl = validatedCertificateUrl(envelope.SigningCertURL);
  const pem = await fetchCertificate(certUrl);
  const authentic = verifySignature(
    canonicalNotification(envelope),
    envelope.Signature,
    envelope.SignatureVersion,
    pem,
  );
  if (!authentic) throw new Error("Invalid SNS signature.");

  return parseSesEvent(envelope.Message);
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

function canonicalNotification(
  envelope: z.infer<typeof envelopeSchema>,
): string {
  const fields: Array<[string, string | undefined]> = [
    ["Message", envelope.Message],
    ["MessageId", envelope.MessageId],
    ["Subject", envelope.Subject],
    ["Timestamp", envelope.Timestamp],
    ["TopicArn", envelope.TopicArn],
    ["Type", envelope.Type],
  ];
  return fields
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}\n${value}\n`)
    .join("");
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
      return { providerRef: parsed.mail.messageId, status: "delivered" };
    case "Bounce":
      return {
        providerRef: parsed.mail.messageId,
        status: "undelivered",
        errorCode: "ses_bounce",
      };
    case "Complaint":
      return {
        providerRef: parsed.mail.messageId,
        status: "undelivered",
        errorCode: "ses_complaint",
      };
    case "Reject":
    case "Rendering Failure":
      return {
        providerRef: parsed.mail.messageId,
        status: "failed",
        errorCode: `ses_${parsed.notificationType.toLowerCase().replaceAll(" ", "_")}`,
      };
    case "Send":
    case "DeliveryDelay":
      return { providerRef: parsed.mail.messageId, status: "sent" };
    default:
      throw new Error("Unsupported SES event.");
  }
}

async function defaultFetchCertificate(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "error" });
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

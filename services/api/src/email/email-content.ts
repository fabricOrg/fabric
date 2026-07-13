import {
  type MessageStatus,
  type SendEmailRequest,
  sendEmailRequest,
} from "@app/contracts";

export function parseEmailContent(
  raw: string | null | undefined,
): SendEmailRequest | null {
  if (!raw) return null;
  try {
    const parsed = sendEmailRequest.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isTerminalEmailStatus(status: MessageStatus): boolean {
  return ["delivered", "undelivered", "failed", "expired"].includes(status);
}

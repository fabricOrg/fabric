import type { ZodError } from "zod";

/**
 * Turn a rejected sandbox-allowance policy into something an operator can act on.
 *
 * Neither obvious option works on its own. A fixed sentence cannot name the field that failed — the
 * one this replaced said "use positive daily limits and give a reason", which described nothing when
 * a THIRD limit was the missing one. Forwarding zod's own message is worse: for the case that
 * actually happened it reads "Invalid input: expected number, received undefined", which names no
 * field at all. So the issue's PATH is what carries the information, and the numeric messages are
 * rewritten in the vocabulary of the form.
 */
const FIELD_LABEL: Record<string, string> = {
  sms_segments_per_day: "SMS segments per UTC day",
  email_messages_per_day: "Email messages per UTC day",
  whatsapp_messages_per_day: "WhatsApp messages per UTC day",
};

const FALLBACK =
  "Check the daily limits and the reason for change, then try again.";

export function sandboxAllowanceIssueMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return FALLBACK;
  const field = String(issue.path[0] ?? "");
  // The reason's message is authored in the schema and already reads as guidance.
  if (field === "reason") return issue.message;
  const label = FIELD_LABEL[field];
  if (!label) return FALLBACK;
  return `${label} must be a whole number between 1 and 1,000,000,000.`;
}

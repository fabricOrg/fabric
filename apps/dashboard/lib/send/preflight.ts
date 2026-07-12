// Send-composer intelligence — pure, dependency-free logic the UI renders. This is the wedge vs a
// raw vendor "text box": we validate + dedupe recipients, suppress opt-outs BEFORE charging, and
// preflight the send for the mistakes that waste money (UCS-2 downgrade) or break delivery
// (unregistered sender ID, DND). Kept pure so it's trivially unit-testable and reusable server-side.
// TODO(BFF): the real /v1/messages should run the SAME rules server-side (single source of truth).

import type { OptOut } from "@/lib/client/consent-api";
import type { SenderId } from "@/lib/client/senders-api";

/** E.164 — leading +, no leading zero, 8–15 digits. Shared with the consent + verify lanes. */
export const E164 = /^\+[1-9]\d{7,14}$/;

export type Country = "GH" | "NG" | "other";

/** Cheap dial-prefix → country. GH (+233) and NG (+234) are the launch markets (see PI-3 decisions). */
export function countryOf(msisdn: string): Country {
  if (msisdn.startsWith("+233")) return "GH";
  if (msisdn.startsWith("+234")) return "NG";
  return "other";
}

export const COUNTRY_LABEL: Record<Country, string> = {
  GH: "Ghana",
  NG: "Nigeria",
  other: "International",
};

export interface RecipientReport {
  /** Non-empty tokens parsed from the textarea (comma/newline separated). */
  readonly raw: number;
  /** Unique, valid E.164 numbers (deduped, order preserved). */
  readonly valid: readonly string[];
  /** Count of tokens that failed E.164. */
  readonly invalid: number;
  /** Duplicate valid numbers that were collapsed. */
  readonly duplicates: number;
  /** Valid numbers on the opt-out/DND list — skipped, never charged. */
  readonly suppressed: readonly string[];
  /** valid − suppressed, order preserved. These are the numbers we actually send + bill. */
  readonly sendable: readonly string[];
  /** sendable broken down by country, for the sender-registration check + display. */
  readonly byCountry: Record<Country, number>;
}

/** Parse → validate → dedupe → suppress. Suppression uses scope:"all" opt-outs (hard block);
 * promotional-only opt-outs are surfaced as a soft preflight note, not removed here. */
export function buildRecipientReport(
  raw: string,
  optOuts: readonly OptOut[],
): RecipientReport {
  const parts = raw
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const validAll = parts.filter((p) => E164.test(p));
  const invalid = parts.length - validAll.length;

  const seen = new Set<string>();
  const valid: string[] = [];
  for (const v of validAll) {
    if (!seen.has(v)) {
      seen.add(v);
      valid.push(v);
    }
  }
  const duplicates = validAll.length - valid.length;

  const blocked = new Set(
    optOuts.filter((o) => o.scope === "all").map((o) => o.msisdn),
  );
  const suppressed = valid.filter((v) => blocked.has(v));
  const sendable = valid.filter((v) => !blocked.has(v));

  const byCountry: Record<Country, number> = { GH: 0, NG: 0, other: 0 };
  for (const s of sendable) byCountry[countryOf(s)] += 1;

  return {
    raw: parts.length,
    valid,
    invalid,
    duplicates,
    suppressed,
    sendable,
    byCountry,
  };
}

export type CheckLevel = "block" | "warn" | "info" | "pass";

export interface PreflightCheck {
  readonly id: string;
  readonly level: CheckLevel;
  readonly title: string;
  readonly detail: string;
}

/** A message is transactional (OTP/alerts) if it reads like one — those are exempt from the
 * opt-out-phrase nudge and from DND on promotional-scope opt-outs. Heuristic, mock-side only. */
const TRANSACTIONAL =
  /\b(otp|code|verify|verification|password|balance|receipt|delivery|order)\b/i;

export interface PreflightInput {
  readonly report: RecipientReport;
  readonly body: string;
  readonly encoding: "gsm7" | "ucs2";
  readonly segments: number;
  readonly senderId: string;
  readonly senders: readonly SenderId[];
}

/** The preflight panel: the money/deliverability/compliance mistakes, caught before Send. */
export function buildPreflight(input: PreflightInput): PreflightCheck[] {
  const { report, body, encoding, segments, senderId, senders } = input;
  const checks: PreflightCheck[] = [];

  if (body.trim().length === 0) return checks;

  // 1) Encoding — UCS-2 silently doubles cost (70-char segments vs 160). The classic bill surprise.
  if (encoding === "ucs2") {
    checks.push({
      id: "encoding",
      level: "warn",
      title: "Emoji or special characters detected",
      detail: `This encodes as UCS-2 — 70 characters per segment instead of 160, so it bills as ${segments} segment${segments === 1 ? "" : "s"}. Remove emoji/curly-quotes to roughly halve the cost.`,
    });
  } else {
    checks.push({
      id: "encoding",
      level: "pass",
      title: "GSM-7 encoding",
      detail: `Standard 160-character segments — ${segments} segment${segments === 1 ? "" : "s"} per message.`,
    });
  }

  // 2) Opt-out phrase — promotional traffic in GH/NG should carry an opt-out; transactional exempt.
  const transactional = TRANSACTIONAL.test(body);
  if (!transactional && !/\bstop\b/i.test(body)) {
    checks.push({
      id: "optout",
      level: "info",
      title: "No opt-out instruction",
      detail:
        "Promotional messages should include an opt-out (e.g. “Reply STOP to opt out”). OTP/transactional messages are exempt.",
    });
  }

  // 3) Sender-ID registration — GH/NG gate delivery on a registered, active originator per country.
  const active = new Set(
    senders
      .filter((s) => s.senderId === senderId && s.status === "active")
      .map((s) => s.country),
  );
  const unregistered = (["GH", "NG"] as const).filter(
    (c) => report.byCountry[c] > 0 && !active.has(c),
  );
  if (unregistered.length > 0) {
    const where = unregistered.map((c) => COUNTRY_LABEL[c]).join(" and ");
    const affected = unregistered.reduce((n, c) => n + report.byCountry[c], 0);
    checks.push({
      id: "sender",
      level: "warn",
      title: `“${senderId}” isn't registered in ${where}`,
      detail: `${affected} recipient${affected === 1 ? "" : "s"} may not receive delivery until this sender ID is approved there. Register it under Compliance → Sender IDs.`,
    });
  } else if (senderId.length > 0) {
    checks.push({
      id: "sender",
      level: "pass",
      title: `“${senderId}” is registered for your recipients`,
      detail: "Active originator in every destination country in this send.",
    });
  }

  // 4) International — no per-country sender registry beyond GH/NG at launch.
  if (report.byCountry.other > 0) {
    checks.push({
      id: "international",
      level: "info",
      title: `${report.byCountry.other} international recipient${report.byCountry.other === 1 ? "" : "s"}`,
      detail:
        "Outside Ghana and Nigeria. Delivery and rate depend on the destination carrier.",
    });
  }

  // 5) Suppressed — surfaced as a positive: we protected spend + compliance automatically.
  if (report.suppressed.length > 0) {
    checks.push({
      id: "suppressed",
      level: "warn",
      title: `${report.suppressed.length} recipient${report.suppressed.length === 1 ? "" : "s"} on your DND list`,
      detail:
        "On your opt-out/DND list — automatically skipped, and you won't be charged for them.",
    });
  }

  // 6) Nothing left to send.
  if (report.raw > 0 && report.sendable.length === 0) {
    checks.push({
      id: "empty",
      level: "block",
      title: "No sendable recipients",
      detail:
        "Every recipient is invalid or suppressed. Fix the numbers above before sending.",
    });
  }

  return checks;
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Merge tokens found in the body, e.g. {{name}} → ["name"]. Unique, order preserved. */
export function extractTokens(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(TOKEN)) {
    const key = match[1];
    if (key) seen.add(key);
  }
  return [...seen];
}

/** Render {{tokens}} against sample values; unknown tokens stay literal so the preview is honest. */
export function renderTemplate(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(TOKEN, (_, key: string) => values[key] || `{{${key}}}`);
}

/** The equivalent API request — the funnel from "I did it by hand" to "I automated it". */
export function apiSnippets(input: {
  to: readonly string[];
  from: string;
  body: string;
}): { curl: string; node: string } {
  const shown = input.to.slice(0, 5);
  const more = input.to.length - shown.length;
  const toDisplay = shown.map((n) => `"${n}"`).join(", ");
  const tail = more > 0 ? ` /* +${more} more */` : "";
  const firstRecipient = shown[0] ?? "+233545227189";
  const from = input.from || "Fabric";
  const body = JSON.stringify(input.body || "Your message");

  const curl = `curl https://api.fabric.africa/v1/sms/send \\
  -H "Authorization: Bearer $FABRIC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: notification-123-0" \\
  -d '{
    "to": "${firstRecipient}",
    "sender_id": "${from}",
    "body": ${body},
    "currency": "GHS"
  }'`;

  const node = `import { Fabric } from "fabric-messaging";

const fabric = new Fabric({ apiKey: process.env.FABRIC_API_KEY });
const recipients = [${toDisplay}${tail}];

for (const [index, to] of recipients.entries()) {
  await fabric.sms.send(
    { to, senderId: "${from}", body: ${body} },
    { idempotencyKey: \`notification-123-\${index}\` },
  );
}`;

  return { curl, node };
}

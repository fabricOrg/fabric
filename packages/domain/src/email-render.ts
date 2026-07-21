import type { VariableSchema } from "@app/contracts";
import {
  extractTokens,
  pathIsDeclaredScalar,
  type RenderError,
  resolve,
  TOKEN,
  validatePayload,
} from "./message-render.js";
import {
  EMAIL_MAX_BYTES,
  type EmailSizeTier,
  emailSizeTier,
  type RateTable,
  rateEmailBySize,
} from "./rating.js";

/**
 * Server-side EMAIL rendering + preview core (SDK-007 slice 2). PURE, like previewSms — the single
 * source both public preview and managed Email send (slice 4) consume, so a preview's rendered
 * subject/text/html, size, and cost equal a subsequent send on the same version + pricing. Field
 * errors carry a JSON path and a stable code and NEVER the rejected value (no PII in a preview).
 *
 * Security: static template markup is AUTHORED (trusted); only VARIABLE VALUES are interpolated. In the
 * html part a value is HTML-escaped so it cannot break out of its context; in the subject a CR/LF from a
 * value is rejected (email header injection). Subject/text are plain-text contexts and need no escaping.
 */

export interface EmailPreview {
  readonly subject: string;
  readonly text: string | null;
  readonly html: string | null;
  readonly size_bytes: number;
  readonly tier: EmailSizeTier;
  readonly cost_minor: string;
  readonly currency: string;
}

export interface EmailPreviewOutcome {
  /** Anything here blocks a send; when non-empty, `preview` is null and nothing was rendered/priced. */
  readonly blockers: readonly RenderError[];
  readonly preview: EmailPreview | null;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain-text substitution (subject, text part). Undeclared/undefined values render empty. */
function renderPlain(template: string, data: unknown): string {
  return template.replace(TOKEN, (_, key: string) => {
    const v = resolve(data, key);
    return v === undefined || v === null ? "" : String(v);
  });
}

/** HTML substitution — the value is escaped so a variable cannot inject markup into the html context. */
function renderHtmlBody(template: string, data: unknown): string {
  return template.replace(TOKEN, (_, key: string) => {
    const v = resolve(data, key);
    return v === undefined || v === null ? "" : htmlEscape(String(v));
  });
}

export function previewEmail(input: {
  subject: string;
  text?: string;
  html?: string;
  schema: VariableSchema;
  data: unknown;
  currency: string;
  rates?: RateTable;
}): EmailPreviewOutcome {
  const blockers: RenderError[] = [];

  // Defensive: the contract (emailVariantContent) requires ≥1 of text/html, but the core must never
  // render an email with no body even if called directly.
  if (input.text === undefined && input.html === undefined) {
    blockers.push({ path: "", code: "email_content_required" });
  }

  // Every template token, across subject + text + html, must be a declared scalar. An undeclared token
  // is an authoring error, not a silent blank (slice-0 §2). Reported at `<part>.<token>`.
  const parts: Array<readonly [string, string]> = [["subject", input.subject]];
  if (input.text !== undefined) parts.push(["text", input.text]);
  if (input.html !== undefined) parts.push(["html", input.html]);
  for (const [part, template] of parts) {
    for (const token of extractTokens(template)) {
      if (!pathIsDeclaredScalar(input.schema, token)) {
        blockers.push({ path: `${part}.${token}`, code: "unknown_token" });
      }
    }
  }
  blockers.push(...validatePayload(input.schema, input.data));
  if (blockers.length > 0) return { blockers, preview: null };

  const subject = renderPlain(input.subject, input.data);
  // The subject is an email header — a CR/LF expanded from a variable would inject headers. Reject it
  // (path-coded, value never echoed) rather than silently stripping.
  if (/[\r\n]/.test(subject)) {
    return {
      blockers: [{ path: "subject", code: "subject_newline" }],
      preview: null,
    };
  }
  const text =
    input.text !== undefined ? renderPlain(input.text, input.data) : null;
  const html =
    input.html !== undefined ? renderHtmlBody(input.html, input.data) : null;

  // Billable size = rendered UTF-8 byte length (isomorphic; no Node Buffer). Deterministic ⇒ parity.
  const size = new TextEncoder().encode(
    subject + (text ?? "") + (html ?? ""),
  ).length;
  const tier = emailSizeTier(size);
  if (size > EMAIL_MAX_BYTES || tier === null) {
    return {
      blockers: [{ path: "", code: "email_payload_too_large" }],
      preview: null,
    };
  }

  const cost = rateEmailBySize(size, input.currency, input.rates);
  return {
    blockers: [],
    preview: {
      subject,
      text,
      html,
      size_bytes: size,
      tier,
      cost_minor: cost.toString(),
      currency: input.currency,
    },
  };
}

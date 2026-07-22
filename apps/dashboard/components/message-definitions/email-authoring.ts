import type { EmailVariantContent } from "@app/contracts";
import {
  type AuthoringVariable,
  variablesFromBody,
} from "./definition-authoring";

/**
 * Email authoring helpers — the Email counterpart of definition-authoring.ts. Variable extraction and
 * the variable-schema build are channel-neutral (they work on token names), so they are reused from
 * definition-authoring; only the token SOURCE (subject + text + html, rather than a single SMS body)
 * and the content-object shape differ here.
 */

export interface EmailLocaleDraft {
  readonly id: string;
  readonly locale: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The email content payload sent to the API (matches the Email arm of the create/add-version union). */
export interface EmailContent {
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  locales: Record<string, { subject?: string; text?: string; html?: string }>;
}

// A raw subject is an email header; a literal line break authored into it (CR, LF, or the unicode
// line/paragraph separators the renderer also rejects — U+2028/U+2029) would be header injection.
// Checked by code point so the source stays pure ASCII (a regex literal containing U+2028 is itself a
// line terminator to the parser). Guarded client-side too, so the author sees it before submit.
function subjectHasLineBreak(subject: string): boolean {
  for (const char of subject) {
    const code = char.charCodeAt(0);
    if (code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

/** Tokens for an email version live across subject + text + html; merge them into one variable set. */
export function variablesFromEmail(
  subject: string,
  text: string,
  html: string,
  current: readonly AuthoringVariable[] = [],
): AuthoringVariable[] {
  // Reuse the SMS extractor over the concatenated templates — extractTokens is body-agnostic.
  return variablesFromBody([subject, text, html].join("\n"), current);
}

export function buildEmailContent(draft: {
  from: string;
  subject: string;
  text: string;
  html: string;
  emailLocalizedVariants: readonly EmailLocaleDraft[];
  defaultLocale: string;
}): { content: EmailContent | null; error: string | null } {
  const subject = draft.subject.trim();
  if (subject.length === 0) {
    return { content: null, error: "Enter the email subject." };
  }
  if (subjectHasLineBreak(draft.subject)) {
    return { content: null, error: "The subject must be a single line." };
  }
  const text = draft.text.trim();
  const html = draft.html.trim();
  if (text.length === 0 && html.length === 0) {
    return {
      content: null,
      error: "Enter a text body, an HTML body, or both.",
    };
  }
  const from = draft.from.trim();
  if (from.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
    return { content: null, error: "Enter a valid From address." };
  }

  const locales = buildEmailLocales(
    draft.emailLocalizedVariants,
    draft.defaultLocale,
  );
  if (!locales.value) {
    return { content: null, error: locales.error };
  }

  return {
    content: {
      ...(from.length > 0 ? { from } : {}),
      subject,
      ...(text.length > 0 ? { text } : {}),
      ...(html.length > 0 ? { html } : {}),
      locales: locales.value,
    },
    error: null,
  };
}

function buildEmailLocales(
  variants: readonly EmailLocaleDraft[],
  defaultLocale: string,
): {
  value: EmailContent["locales"] | null;
  error: string | null;
} {
  const value: EmailContent["locales"] = {};
  for (const variant of variants) {
    const locale = variant.locale.trim();
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)) {
      return {
        value: null,
        error: `Enter a valid locale for “${locale || "untitled"}”.`,
      };
    }
    if (locale === defaultLocale) {
      return { value: null, error: `${locale} is already the default locale.` };
    }
    if (value[locale]) {
      return { value: null, error: `${locale} is listed more than once.` };
    }
    const subject = variant.subject.trim();
    if (subject.length > 0 && subjectHasLineBreak(variant.subject)) {
      return {
        value: null,
        error: `The ${locale} subject must be a single line.`,
      };
    }
    const text = variant.text.trim();
    const html = variant.html.trim();
    if (subject.length === 0 && text.length === 0 && html.length === 0) {
      return {
        value: null,
        error: `Enter a subject or body override for ${locale}, or remove it.`,
      };
    }
    // A locale override is a partial patch — only include the fields the author actually set.
    value[locale] = {
      ...(subject.length > 0 ? { subject } : {}),
      ...(text.length > 0 ? { text } : {}),
      ...(html.length > 0 ? { html } : {}),
    };
  }
  return { value, error: null };
}

/** Rebuild the editor's per-locale draft rows from a stored email content's locales map (Edit flow). */
export function emailLocalesToDrafts(
  content: EmailVariantContent,
): EmailLocaleDraft[] {
  return Object.entries(content.locales).map(([locale, override]) => ({
    id: crypto.randomUUID(),
    locale,
    subject: override.subject ?? "",
    text: override.text ?? "",
    html: override.html ?? "",
  }));
}

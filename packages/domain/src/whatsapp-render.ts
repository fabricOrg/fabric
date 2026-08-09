import type { VariableSchema } from "@app/contracts";
import {
  pathIsDeclaredScalar,
  type RenderError,
  resolve,
  validatePayload,
} from "./message-render.js";
import { type RateTable, rateWhatsappFlat } from "./rating.js";

/**
 * Server-side WHATSAPP rendering + preview core. PURE, like previewSms/previewEmail — the single source
 * both public preview and managed WhatsApp send consume, so a preview's resolved parameters and cost
 * equal a subsequent send on the same version + pricing.
 *
 * WhatsApp does not render a body. The body lives in a Meta-approved template we do not own and cannot
 * inspect at render time; what we render is the ARGUMENT LIST. So this core's job is narrower than the
 * other two and, in one respect, stricter: it must produce positional parameters Meta will accept,
 * because a parameter Meta rejects fails AFTER money is reserved and after the delivery row exists.
 *
 * Security: there is no interpolation into authored markup here, so no escaping question arises — a
 * value cannot break out of a context that doesn't exist. The injection surface is Meta's own parameter
 * grammar instead, enforced below.
 */

export interface WhatsappPreview {
  readonly template_name: string;
  readonly template_language: string;
  readonly template_category: "marketing" | "utility" | "authentication";
  /** The rendered POSITIONAL body parameters, in template order. */
  readonly parameters: readonly string[];
  readonly cost_minor: string;
  readonly currency: string;
}

export interface WhatsappPreviewOutcome {
  /** Anything here blocks a send; when non-empty, `preview` is null and nothing was rendered/priced. */
  readonly blockers: readonly RenderError[];
  readonly preview: WhatsappPreview | null;
}

/**
 * Meta's body-parameter grammar: a parameter may not contain a newline or tab, nor more than four
 * consecutive spaces. Meta rejects the whole message on violation, so catching it here turns a
 * post-reserve provider failure into a pre-acceptance blocker.
 */
const FORBIDDEN_PARAMETER_TEXT = /[\r\n\t]|\s{5,}/;

/** Meta's per-parameter ceiling. Matches `whatsappSendRequest.variables`' max in @app/contracts. */
export const WHATSAPP_PARAMETER_MAX_CHARS = 1024;

export function previewWhatsapp(input: {
  templateName: string;
  templateLanguage: string;
  templateCategory: "marketing" | "utility" | "authentication";
  /** ORDERED variable names from the definition's schema — position IS meaning (see contracts). */
  parameters: readonly string[];
  schema: VariableSchema;
  data: unknown;
  currency: string;
  rates?: RateTable;
}): WhatsappPreviewOutcome {
  const blockers: RenderError[] = [];

  // Every named parameter must be a declared scalar. Unlike SMS/email — where an undeclared token is
  // an authoring typo that would render blank — an undeclared parameter here would send a positional
  // EMPTY STRING, silently shifting nothing but corrupting the message Meta assembles.
  input.parameters.forEach((name, index) => {
    if (!pathIsDeclaredScalar(input.schema, name)) {
      blockers.push({ path: `parameters.${index}`, code: "unknown_token" });
    }
  });
  blockers.push(...validatePayload(input.schema, input.data));
  if (blockers.length > 0) return { blockers, preview: null };

  const rendered: string[] = [];
  input.parameters.forEach((name, index) => {
    const value = resolve(input.data, name);
    // An absent optional variable would become an empty positional parameter, which Meta rejects and
    // which would in any case leave a hole in the customer-visible message. Block rather than send it.
    if (value === undefined || value === null) {
      blockers.push({ path: `parameters.${index}`, code: "parameter_empty" });
      return;
    }
    const text = String(value);
    if (text.length === 0) {
      blockers.push({ path: `parameters.${index}`, code: "parameter_empty" });
      return;
    }
    if (text.length > WHATSAPP_PARAMETER_MAX_CHARS) {
      blockers.push({
        path: `parameters.${index}`,
        code: "parameter_too_long",
      });
      return;
    }
    if (FORBIDDEN_PARAMETER_TEXT.test(text)) {
      // Path-coded, value never echoed — a preview must not leak the payload (same rule as SMS/email).
      blockers.push({
        path: `parameters.${index}`,
        code: "parameter_whitespace",
      });
      return;
    }
    rendered.push(text);
  });
  if (blockers.length > 0) return { blockers, preview: null };

  // Flat per-template-message price (ADR-0014 §3). WhatsApp's own conversation-based pricing is the
  // COST side; what we sell is one priced message, so preview and send agree on a single number.
  const cost = rateWhatsappFlat(input.currency, input.rates);
  return {
    blockers: [],
    preview: {
      template_name: input.templateName,
      template_language: input.templateLanguage,
      template_category: input.templateCategory,
      parameters: rendered,
      cost_minor: cost.toString(),
      currency: input.currency,
    },
  };
}

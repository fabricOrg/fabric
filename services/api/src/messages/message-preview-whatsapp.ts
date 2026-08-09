import type { VariableSchema, WhatsappVariantContent } from "@app/contracts";
import { previewWhatsapp, type RateTable, type RenderError } from "@app/domain";
import type { PreviewOutput } from "./message-preview-output.js";

/**
 * WhatsApp preview branch (ADR-0014), split out of MessagePreviewService for the file-length guard.
 * READ-ONLY like the SMS/Email branches: no wallet reserve, provider call, or PII write.
 *
 * Two things are deliberately NOT evaluated here:
 *
 * - The SMS sender/compliance pair. A WhatsApp sender is the WABA phone number carried by the
 *   workspace's Meta credentials, resolved at dispatch — there is no authored binding to check, so
 *   `sender.status` reports `not_evaluated` exactly as the Email branch does.
 * - Meta's template APPROVAL state. That is control-plane state we cache and Meta can change without
 *   telling us; the send path checks it fresh (whatsapp-prepare) with a fail-open on staleness. Asserting
 *   it here would make a read-only preview depend on an external control plane and would still be a
 *   guess by the time the send ran.
 */
export function whatsappPreview(input: {
  content: WhatsappVariantContent;
  schema: VariableSchema;
  data: unknown;
  currency: string;
  rates: RateTable;
  resolvedLocale: string;
  defaultLocale: string;
  definitionId: string;
  versionId: string;
  environment: "sandbox" | "live";
}): PreviewOutput {
  // A locale override names a DIFFERENT Meta template (one template per name+language), so resolving
  // the locale means resolving which template row we are binding to — not merging strings.
  const language = resolveTemplateLanguage(
    input.content,
    input.resolvedLocale,
    input.defaultLocale,
  );
  const outcome = language
    ? previewWhatsapp({
        templateName: input.content.template_name,
        templateLanguage: language,
        templateCategory: input.content.template_category,
        parameters: input.content.parameters,
        schema: input.schema,
        data: input.data,
        currency: input.currency,
        rates: input.rates,
      })
    : {
        blockers: [
          { path: "locale", code: "locale_not_supported" },
        ] satisfies RenderError[],
        preview: null,
      };
  return {
    channel: "whatsapp",
    definition_id: input.definitionId,
    version_id: input.versionId,
    environment: input.environment,
    resolved_locale: input.resolvedLocale,
    blockers: outcome.blockers,
    warnings: [],
    eligible: outcome.blockers.length === 0,
    sender: { sender_id: "", status: "not_evaluated" },
    // Meta's own template category (marketing / utility / authentication) is the finer-grained truth and
    // travels on the preview result. This coarse field exists for the SMS consent rules; mapping
    // marketing → promotional keeps a caller that branches on it from treating a marketing template as
    // transactional traffic.
    message_class:
      input.content.template_category === "marketing"
        ? "promotional"
        : "transactional",
    preview: null,
    email_preview: null,
    whatsapp_preview: outcome.blockers.length === 0 ? outcome.preview : null,
    email_from: null,
  };
}

/** The Meta template language for a locale: the base for the default locale, else the override's. */
function resolveTemplateLanguage(
  content: WhatsappVariantContent,
  locale: string,
  defaultLocale: string,
): string | null {
  if (locale === defaultLocale) return content.template_language;
  return content.locales?.[locale]?.template_language ?? null;
}

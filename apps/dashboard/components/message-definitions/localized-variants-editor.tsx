"use client";

import { Button } from "@app/ui/components/ui/button";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { LocaleSelect } from "@app/ui/components/ui/locale-select";
import { Textarea } from "@app/ui/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { AUTHORING_LOCALES } from "@/lib/locales";

export interface LocalizedVariantDraft {
  id: string;
  locale: string;
  body: string;
}

export function LocalizedVariantsEditor({
  variants,
  onChange,
  defaultLocale,
}: {
  variants: readonly LocalizedVariantDraft[];
  onChange: (variants: LocalizedVariantDraft[]) => void;
  /** Excluded from the options — a variant for the default locale is what "Message body" already is. */
  defaultLocale?: string;
}) {
  function update(id: string, patch: Partial<LocalizedVariantDraft>) {
    onChange(
      variants.map((variant) =>
        variant.id === id ? { ...variant, ...patch } : variant,
      ),
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Additional locales</h3>
          <p className="text-xs text-muted-foreground">
            Adding a locale is compatible. Removing a released locale requires a
            new stable key.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange([
              ...variants,
              { id: crypto.randomUUID(), locale: "", body: "" },
            ])
          }
        >
          <Plus /> Add locale
        </Button>
      </div>
      {variants.map((variant) => (
        <div key={variant.id} className="space-y-2 rounded-md border p-3">
          <div className="flex items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor={`locale-${variant.id}`}>Locale</FieldLabel>
              <LocaleSelect
                id={`locale-${variant.id}`}
                value={variant.locale}
                onChange={(locale) => update(variant.id, { locale })}
                // Offer only locales not already used by the default or another variant, so the same
                // language cannot be authored twice in one version.
                locales={AUTHORING_LOCALES.filter(
                  (option) =>
                    option !== defaultLocale &&
                    !variants.some(
                      (other) =>
                        other.id !== variant.id && other.locale === option,
                    ),
                )}
                placeholder="Select a locale"
              />
            </Field>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove ${variant.locale || "locale"}`}
              onClick={() =>
                onChange(variants.filter((item) => item.id !== variant.id))
              }
            >
              <Trash2 />
            </Button>
          </div>
          <Field>
            <FieldLabel htmlFor={`locale-body-${variant.id}`}>
              Message
            </FieldLabel>
            <Textarea
              id={`locale-body-${variant.id}`}
              rows={3}
              maxLength={1600}
              value={variant.body}
              onChange={(event) =>
                update(variant.id, { body: event.target.value })
              }
            />
          </Field>
        </div>
      ))}
    </section>
  );
}

export function buildLocales(
  variants: readonly LocalizedVariantDraft[],
  defaultLocale: string,
): { value: Record<string, { body: string }> | null; error: string | null } {
  const value: Record<string, { body: string }> = {};
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
    if (!variant.body.trim()) {
      return { value: null, error: `Enter the ${locale} message.` };
    }
    value[locale] = { body: variant.body.trim() };
  }
  return { value, error: null };
}

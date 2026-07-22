"use client";

import { Button } from "@app/ui/components/ui/button";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import { Textarea } from "@app/ui/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import type { EmailLocaleDraft } from "./email-authoring";

/**
 * Per-locale email overrides. Unlike the SMS editor (a single `body`), each override is a partial patch
 * over subject/text/html — any field left blank falls back to the default-locale content at send time.
 */
export function EmailLocalizedVariantsEditor({
  variants,
  onChange,
}: {
  variants: readonly EmailLocaleDraft[];
  onChange: (variants: EmailLocaleDraft[]) => void;
}) {
  function update(id: string, patch: Partial<EmailLocaleDraft>) {
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
            Override the subject or bodies per locale. Blank fields fall back to
            the default locale. Removing a released locale requires a new key.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange([
              ...variants,
              {
                id: crypto.randomUUID(),
                locale: "",
                subject: "",
                text: "",
                html: "",
              },
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
              <FieldLabel htmlFor={`email-locale-${variant.id}`}>
                Locale
              </FieldLabel>
              <Input
                id={`email-locale-${variant.id}`}
                value={variant.locale}
                onChange={(event) =>
                  update(variant.id, { locale: event.target.value })
                }
                placeholder="fr or en-GH"
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
            <FieldLabel htmlFor={`email-locale-subject-${variant.id}`}>
              Subject
            </FieldLabel>
            <Input
              id={`email-locale-subject-${variant.id}`}
              maxLength={998}
              value={variant.subject}
              onChange={(event) =>
                update(variant.id, { subject: event.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`email-locale-text-${variant.id}`}>
              Text body
            </FieldLabel>
            <Textarea
              id={`email-locale-text-${variant.id}`}
              rows={3}
              value={variant.text}
              onChange={(event) =>
                update(variant.id, { text: event.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`email-locale-html-${variant.id}`}>
              HTML body
            </FieldLabel>
            <Textarea
              id={`email-locale-html-${variant.id}`}
              className="font-mono text-xs"
              rows={3}
              value={variant.html}
              onChange={(event) =>
                update(variant.id, { html: event.target.value })
              }
            />
          </Field>
        </div>
      ))}
    </section>
  );
}

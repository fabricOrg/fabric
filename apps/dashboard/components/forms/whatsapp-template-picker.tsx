"use client";

import type { WhatsappTemplateSummary } from "@app/contracts";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@app/ui/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Skeleton } from "@app/ui/components/ui/skeleton";

/**
 * Choosing a WhatsApp template, rather than typing one from memory.
 *
 * The shape of this component follows a constraint from Meta: a template is identified by NAME +
 * LANGUAGE together, and the same name usually exists in several languages. So it is two selects, not
 * one — pick the template, then pick the language it exists in — instead of a single flat list that
 * would repeat every name once per translation.
 *
 * The category is DISPLAYED and never chosen. Meta owns it, and it does not travel to Meta on a send:
 * it drives our consent gate and our pricing traffic class, so letting a sender pick `utility` for a
 * template Meta approved as `marketing` would skip the promotional consent check and bill the wrong
 * class. Showing it read-only is what keeps those two honest.
 */
export function WhatsappTemplatePicker({
  templates,
  isLoading,
  error,
  onRetry,
  name,
  language,
  onNameChange,
  onLanguageChange,
}: {
  templates: readonly WhatsappTemplateSummary[];
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
  name: string;
  language: string;
  onNameChange: (name: string, language: string) => void;
  onLanguageChange: (language: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel>Template</FieldLabel>
          <Skeleton className="h-9 w-full" />
        </Field>
        <Field>
          <FieldLabel>Language</FieldLabel>
          <Skeleton className="h-9 w-full" />
        </Field>
      </div>
    );
  }

  // Deliberately NOT falling back to a free-text field. A name Meta does not have fails at the
  // provider after the wallet reserve, so an unavailable catalog has to block composing rather than
  // quietly restore the guesswork this picker replaced.
  if (error) {
    return (
      <Field>
        <FieldLabel>Template</FieldLabel>
        <p className="text-sm text-destructive">
          Approved templates could not be loaded, so there is nothing safe to
          send yet.{" "}
          <button
            type="button"
            onClick={onRetry}
            className="underline underline-offset-4"
          >
            Try again
          </button>
        </p>
      </Field>
    );
  }

  if (templates.length === 0) {
    return (
      <Field>
        <FieldLabel>Template</FieldLabel>
        <FieldDescription>
          No approved templates yet. WhatsApp only delivers pre-approved
          templates, so create one in Meta Business Manager and it will appear
          here once approved.
        </FieldDescription>
      </Field>
    );
  }

  const names = [...new Set(templates.map((t) => t.name))];
  const languages = templates
    .filter((t) => t.name === name)
    .map((t) => t.language);
  const selected = templates.find(
    (t) => t.name === name && t.language === language,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="whatsapp-template">Template</FieldLabel>
          <Select
            value={name || undefined}
            onValueChange={(next) => {
              // Changing template resets the language to one this template actually has. Carrying the
              // previous language across would send a name+language pair Meta has no template for.
              const first = templates.find((t) => t.name === next);
              onNameChange(next, first?.language ?? "");
            }}
          >
            <SelectTrigger id="whatsapp-template">
              <SelectValue placeholder="Choose a template" />
            </SelectTrigger>
            <SelectContent>
              {names.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Only templates Meta has approved for this workspace.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="whatsapp-language">Language</FieldLabel>
          <Select
            value={language || undefined}
            onValueChange={onLanguageChange}
            disabled={!name}
          >
            <SelectTrigger id="whatsapp-language">
              <SelectValue placeholder={name ? "Choose" : "Pick a template"} />
            </SelectTrigger>
            <SelectContent>
              {languages.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Meta stores one template per name and language.
          </FieldDescription>
        </Field>
      </div>

      {selected ? (
        <Field>
          <FieldLabel>Approved content</FieldLabel>
          <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {selected.body_preview ?? "This template has no body text."}
          </p>
          <FieldDescription>
            Category:{" "}
            <span className="text-foreground">
              {selected.category ?? "unknown"}
            </span>{" "}
            — set by Meta, not by you.{" "}
            {selected.variable_count > 0
              ? `Expects ${selected.variable_count} variable${selected.variable_count === 1 ? "" : "s"}.`
              : "Takes no variables."}
          </FieldDescription>
        </Field>
      ) : null}
    </div>
  );
}

"use client";

import type { WhatsappTemplateSummary } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Skeleton } from "@app/ui/components/ui/skeleton";

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

  if (error) {
    return (
      <Field>
        <FieldLabel>Template</FieldLabel>
        <p className="text-destructive text-sm">
          Approved templates could not be loaded.{" "}
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
        <p className="text-muted-foreground text-sm">
          No approved templates yet.
        </p>
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
        </Field>
      </div>

      {selected ? (
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Approved content</FieldLabel>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge variant="secondary">
                {selected.category ?? "unknown"}
              </Badge>
              <Badge variant="outline">
                {selected.variable_count}{" "}
                {selected.variable_count === 1 ? "variable" : "variables"}
              </Badge>
            </div>
          </div>
          <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-muted-foreground text-sm">
            {selected.body_preview ?? "This template has no body text."}
          </p>
        </Field>
      ) : null}
    </div>
  );
}

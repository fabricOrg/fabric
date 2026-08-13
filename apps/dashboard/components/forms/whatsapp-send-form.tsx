"use client";

import {
  type WhatsappSendRequest,
  type WhatsappTemplateSummary,
  whatsappSendRequest,
} from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { FieldError, fieldInvalid } from "@app/ui/components/ui/form";
import { Input } from "@app/ui/components/ui/input";
import { Textarea } from "@app/ui/components/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { getWhatsappTemplates, sendWhatsapp } from "@/lib/client/dashboard-api";
import { toastApiError } from "@/lib/error-toast";
import { WhatsappTemplatePicker } from "./whatsapp-template-picker";

const variableLines = z.string().refine(
  (value) =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .every((line) => line.length <= 1024),
  "Each variable must be 1,024 characters or fewer.",
);

const formSchema = z.object({
  to: whatsappSendRequest.shape.to,
  template_name: whatsappSendRequest.shape.template_name,
  template_language: whatsappSendRequest.shape.template_language,
  template_category: whatsappSendRequest.shape.template_category,
  variables: variableLines,
});

type FormValues = z.infer<typeof formSchema>;

const DEFAULTS: FormValues = {
  to: "",
  template_name: "",
  template_language: "en",
  template_category: "utility",
  variables: "",
};

/**
 * The template's own category, or `utility` when we cannot tell.
 *
 * The fallback is the conservative direction ONLY for billing; it is not a licence to send marketing
 * traffic. A template whose category Meta did not report renders as "unknown" in the picker, and the
 * send path still applies the consent rules for whatever it is given — the point here is simply never
 * to leave a stale `marketing` selection attached to a utility template.
 */
function categoryFor(
  templates: readonly WhatsappTemplateSummary[] | undefined,
  name: string,
  language: string,
): WhatsappSendRequest["template_category"] {
  const match = templates?.find(
    (t) => t.name === name && t.language === language,
  );
  return match?.category ?? "utility";
}

/** How many variables the chosen template expects, or null when nothing is chosen yet. */
function expectedVariables(
  templates: readonly WhatsappTemplateSummary[] | undefined,
  name: string,
  language: string,
): number | null {
  const match = templates?.find(
    (t) => t.name === name && t.language === language,
  );
  return match ? match.variable_count : null;
}

function variablesFromText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function WhatsappSendForm({ onSent }: { onSent: () => void }) {
  const templates = useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: getWhatsappTemplates,
    // The catalog is a cache of Meta's state that a scheduled sync refreshes hourly; re-reading it on
    // every mount is wasted work, and a minute of staleness cannot make an approved template invalid
    // in a way the SEND path does not re-check anyway (whatsapp-prepare asserts sendability).
    staleTime: 60_000,
  });
  const form = useForm({
    defaultValues: DEFAULTS,
    validators: { onChange: formSchema },
    onSubmit: async ({ value }) => {
      const payload = whatsappSendRequest.parse({
        to: value.to.trim(),
        template_name: value.template_name.trim(),
        template_language: value.template_language.trim(),
        template_category: value.template_category,
        variables: variablesFromText(value.variables),
      });
      try {
        await sendWhatsapp(payload, crypto.randomUUID());
        toast.success("WhatsApp message queued");
        form.reset();
        onSent();
      } catch (error) {
        toastApiError(error);
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      <div className="grid gap-4 md:grid-cols-2">
        <form.Field name="to">
          {(field) => {
            const invalid = fieldInvalid(field);
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="whatsapp-to">Recipient</FieldLabel>
                <Input
                  id="whatsapp-to"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+233201234567"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={invalid || undefined}
                />
                {invalid ? <FieldError field={field} /> : null}
              </Field>
            );
          }}
        </form.Field>
      </div>

      <form.Subscribe
        selector={(state) => [
          state.values.template_name,
          state.values.template_language,
        ]}
      >
        {([templateName, templateLanguage]) => (
          <WhatsappTemplatePicker
            templates={templates.data?.templates ?? []}
            isLoading={templates.isPending}
            error={templates.isError}
            onRetry={() => void templates.refetch()}
            name={templateName ?? ""}
            language={templateLanguage ?? ""}
            onNameChange={(name, language) => {
              form.setFieldValue("template_name", name);
              form.setFieldValue("template_language", language);
              // Category is derived, never chosen — see WhatsappTemplatePicker.
              form.setFieldValue(
                "template_category",
                categoryFor(templates.data?.templates, name, language),
              );
            }}
            onLanguageChange={(language) => {
              form.setFieldValue("template_language", language);
              form.setFieldValue(
                "template_category",
                categoryFor(
                  templates.data?.templates,
                  templateName ?? "",
                  language,
                ),
              );
            }}
          />
        )}
      </form.Subscribe>

      <form.Subscribe
        selector={(state) => [
          state.values.template_name,
          state.values.template_language,
          state.values.variables,
        ]}
      >
        {([templateName, templateLanguage, variablesText]) => {
          const expected = expectedVariables(
            templates.data?.templates,
            templateName ?? "",
            templateLanguage ?? "",
          );
          const supplied = variablesFromText(variablesText ?? "").length;
          // Meta rejects a parameter count that differs from the template's, and that rejection lands
          // AFTER the wallet reserve — so the count is checked here, where it costs nothing.
          const mismatch = expected !== null && supplied !== expected;
          if (expected === 0) return null;
          return (
            <form.Field name="variables">
              {(field) => {
                const invalid = fieldInvalid(field);
                return (
                  <Field data-invalid={invalid || mismatch || undefined}>
                    <FieldLabel htmlFor="whatsapp-variables">
                      Variables
                    </FieldLabel>
                    <Textarea
                      id="whatsapp-variables"
                      rows={Math.max(2, expected ?? 4)}
                      placeholder={["Ada", "ORD-1042"].join("\n")}
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={invalid || mismatch || undefined}
                    />
                    {invalid ? (
                      <FieldError field={field} />
                    ) : (
                      <p
                        className={`text-xs ${
                          mismatch
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {expected === null
                          ? "One variable per line"
                          : `${supplied} / ${expected} variables`}
                      </p>
                    )}
                  </Field>
                );
              }}
            </form.Field>
          );
        }}
      </form.Subscribe>

      <form.Subscribe
        selector={(state) => ({
          isSubmitting: state.isSubmitting,
          name: state.values.template_name,
          language: state.values.template_language,
          variables: state.values.variables,
        })}
      >
        {({ isSubmitting, name, language, variables }) => {
          const expected = expectedVariables(
            templates.data?.templates,
            name,
            language,
          );
          const ready =
            name.length > 0 &&
            language.length > 0 &&
            (expected === null ||
              variablesFromText(variables).length === expected);
          return (
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={!ready}
              className="self-start"
            >
              <Send data-icon="inline-start" />
              Send WhatsApp
            </Button>
          );
        }}
      </form.Subscribe>
    </form>
  );
}

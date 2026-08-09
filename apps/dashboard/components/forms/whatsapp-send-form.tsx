"use client";

import { whatsappSendRequest } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { FieldError, fieldInvalid } from "@app/ui/components/ui/form";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Textarea } from "@app/ui/components/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { sendWhatsapp } from "@/lib/client/dashboard-api";
import { toastApiError } from "@/lib/error-toast";

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

function variablesFromText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function WhatsappSendForm({ onSent }: { onSent: () => void }) {
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
                {invalid ? (
                  <FieldError field={field} />
                ) : (
                  <FieldDescription>
                    One E.164 WhatsApp number.
                  </FieldDescription>
                )}
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="template_name">
          {(field) => {
            const invalid = fieldInvalid(field);
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="whatsapp-template">
                  Template name
                </FieldLabel>
                <Input
                  id="whatsapp-template"
                  placeholder="order_update"
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

      <div className="grid gap-4 md:grid-cols-2">
        <form.Field name="template_language">
          {(field) => {
            const invalid = fieldInvalid(field);
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="whatsapp-language">
                  Template language
                </FieldLabel>
                <Input
                  id="whatsapp-language"
                  placeholder="en"
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

        <form.Field name="template_category">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="whatsapp-category">
                Template category
              </FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(value) => {
                  if (
                    value === "marketing" ||
                    value === "utility" ||
                    value === "authentication"
                  ) {
                    field.handleChange(value);
                  }
                }}
              >
                <SelectTrigger id="whatsapp-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utility">Utility</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="authentication">Authentication</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
      </div>

      <form.Field name="variables">
        {(field) => {
          const invalid = fieldInvalid(field);
          return (
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="whatsapp-variables">Variables</FieldLabel>
              <Textarea
                id="whatsapp-variables"
                rows={4}
                placeholder={"Ada\nORD-1042"}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={invalid || undefined}
              />
              {invalid ? (
                <FieldError field={field} />
              ) : (
                <FieldDescription>
                  One variable per line, in template placeholder order.
                </FieldDescription>
              )}
            </Field>
          );
        }}
      </form.Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" loading={isSubmitting} className="self-start">
            <Send data-icon="inline-start" />
            Send WhatsApp
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

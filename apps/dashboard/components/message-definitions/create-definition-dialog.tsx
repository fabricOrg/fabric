"use client";

import {
  type MessageChannel,
  type MessageDefinitionState,
  type SmsTemplate,
  stableKey,
} from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Textarea } from "@app/ui/components/ui/textarea";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DefinitionApplicationField } from "./definition-application-field";
import {
  resolveAuthoringSchema,
  supportsVisualSchema,
  variablesFromBody,
  variablesFromSchema,
} from "./definition-authoring";
import { DefinitionDeliveryFields } from "./definition-delivery-fields";
import { initialDefinitionDraft } from "./definition-draft";
import { DefinitionPreviewPanel } from "./definition-preview-panel";
import { DefinitionSchemaEditor } from "./definition-schema-editor";
import { buildEmailContent, variablesFromEmail } from "./email-authoring";
import { EmailContentFields } from "./email-content-fields";
import { EmailLocalizedVariantsEditor } from "./email-localized-variants-editor";
import { EmailPreviewPanel } from "./email-preview-panel";
import {
  buildLocales,
  LocalizedVariantsEditor,
} from "./localized-variants-editor";

interface BffErrorPayload {
  error?: { message?: string };
}

export function CreateDefinitionDialog({
  triggerLabel = "New definition",
  triggerVariant = "default",
  initialTemplate,
  initialDefinition,
  initialApplicationId = "",
}: {
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost";
  initialTemplate?: SmsTemplate;
  initialDefinition?: MessageDefinitionState;
  initialApplicationId?: string;
}) {
  const router = useRouter();
  const initial = initialDefinitionDraft(initialTemplate, initialDefinition);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<MessageChannel>(initial.channel);
  const [key, setKey] = useState(initial.key);
  const [variables, setVariables] = useState(initial.variables);
  const [locale, setLocale] = useState(initial.locale);
  const [schemaText, setSchemaText] = useState(initial.schemaText);
  const [advancedSchema, setAdvancedSchema] = useState(initial.advancedSchema);
  // SMS content
  const [body, setBody] = useState(initial.body);
  const [messageClass, setMessageClass] = useState(initial.messageClass);
  const [senderId, setSenderId] = useState(initial.senderId);
  const [localizedVariants, setLocalizedVariants] = useState(
    initial.localizedVariants,
  );
  // Email content
  const [from, setFrom] = useState(initial.from);
  const [subject, setSubject] = useState(initial.subject);
  const [text, setText] = useState(initial.text);
  const [html, setHtml] = useState(initial.html);
  const [emailLocalizedVariants, setEmailLocalizedVariants] = useState(
    initial.emailLocalizedVariants,
  );
  const [applicationId, setApplicationId] = useState(
    initialDefinition?.definition.application_id ?? initialApplicationId,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const builtSchema = resolveAuthoringSchema(
    advancedSchema,
    schemaText,
    variables,
  );
  const editing = Boolean(initialDefinition);
  // Channel is chosen once and is immutable across versions (the API enforces it), so the selector
  // only appears when authoring a brand-new definition. A template is always SMS.
  const channelLocked = editing || Boolean(initialTemplate);

  function reset(template?: SmsTemplate, definition?: MessageDefinitionState) {
    const draft = initialDefinitionDraft(template, definition);
    setChannel(draft.channel);
    setKey(draft.key);
    setVariables(draft.variables);
    setLocale(draft.locale);
    setSchemaText(draft.schemaText);
    setAdvancedSchema(draft.advancedSchema);
    setBody(draft.body);
    setMessageClass(draft.messageClass);
    setSenderId(draft.senderId);
    setLocalizedVariants(draft.localizedVariants);
    setFrom(draft.from);
    setSubject(draft.subject);
    setText(draft.text);
    setHtml(draft.html);
    setEmailLocalizedVariants(draft.emailLocalizedVariants);
    setApplicationId(
      definition?.definition.application_id ?? initialApplicationId,
    );
    setError(null);
  }

  // Tokens are re-derived from whichever channel's content is active, so switching channel repopulates
  // the variable set from the new content.
  function switchChannel(next: MessageChannel) {
    setChannel(next);
    setVariables((current) =>
      next === "email"
        ? variablesFromEmail(subject, text, html, current)
        : variablesFromBody(body, current),
    );
    setError(null);
  }

  function updateEmailContent(next: {
    subject?: string;
    text?: string;
    html?: string;
  }) {
    const nextSubject = next.subject ?? subject;
    const nextText = next.text ?? text;
    const nextHtml = next.html ?? html;
    if (next.subject !== undefined) setSubject(next.subject);
    if (next.text !== undefined) setText(next.text);
    if (next.html !== undefined) setHtml(next.html);
    setVariables((current) =>
      variablesFromEmail(nextSubject, nextText, nextHtml, current),
    );
  }

  function buildRequestBody():
    | { body: Record<string, unknown> }
    | { error: string } {
    if (!stableKey.safeParse(key.trim()).success) {
      return { error: "Enter a valid stable key, e.g. order.shipped." };
    }
    if (locale.trim().length < 2) {
      return { error: "Enter a valid default locale, such as en or en-GH." };
    }
    if (!editing && applicationId.length === 0) {
      return { error: "Choose the application that owns this definition." };
    }
    if (!builtSchema.schema) {
      return { error: builtSchema.error ?? "The variable schema is invalid." };
    }
    const shared = {
      ...(editing ? {} : { key: key.trim() }),
      ...(editing ? {} : { application_id: applicationId }),
      variable_schema: builtSchema.schema,
      default_locale: locale.trim(),
    };

    if (channel === "email") {
      const content = buildEmailContent({
        from,
        subject,
        text,
        html,
        emailLocalizedVariants,
        defaultLocale: locale.trim(),
      });
      if (!content.content) {
        return { error: content.error ?? "Review the email content." };
      }
      return {
        body: { channel: "email", ...shared, content: content.content },
      };
    }

    if (body.trim().length === 0) {
      return { error: "Enter the message body." };
    }
    if (!editing && senderId.trim().length === 0) {
      return { error: "Choose the sandbox sender for this definition." };
    }
    const locales = buildLocales(localizedVariants, locale.trim());
    if (!locales.value) {
      return { error: locales.error ?? "Review the additional locales." };
    }
    return {
      body: {
        channel: "sms",
        ...shared,
        content: {
          body: body.trim(),
          class: messageClass,
          locales: locales.value,
        },
        sender_id: senderId.trim(),
      },
    };
  }

  async function submit() {
    setError(null);
    const built = buildRequestBody();
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setSubmitting(true);
    try {
      const url = initialDefinition
        ? `/api/dashboard/message-definitions/${initialDefinition.definition.id}/versions`
        : "/api/dashboard/message-definitions";
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.body),
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as BffErrorPayload | null;
        throw new Error(
          payload?.error?.message ?? "Couldn't create the definition.",
        );
      }
      toast.success(
        editing
          ? `Created a new ${key.trim()} version`
          : `Created ${key.trim()}`,
        { description: "Publish the latest version to update sandbox." },
      );
      setOpen(false);
      reset();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't create the definition.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setError(null);
        if (nextOpen) reset(initialTemplate, initialDefinition);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>
          {editing ? (
            <Pencil className="size-4" />
          ) : (
            <Plus className="size-4" />
          )}
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Create a new version" : "New message definition"}
          </DialogTitle>
          <DialogDescription>
            Review the stable key, message, variables, and live output before
            creating the draft.
            {initialTemplate
              ? " The original SMS template will remain unchanged."
              : " Tokens such as {{name}} are detected automatically."}
          </DialogDescription>
        </DialogHeader>
        {!editing ? (
          <DefinitionApplicationField
            enabled={open}
            applicationId={applicationId}
            onChange={setApplicationId}
          />
        ) : null}
        {!channelLocked ? (
          <Field>
            <FieldLabel htmlFor="def-channel">Channel</FieldLabel>
            <Select
              value={channel}
              onValueChange={(next) => switchChannel(next as MessageChannel)}
            >
              <SelectTrigger id="def-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              A definition's channel is fixed once created.
            </FieldDescription>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="def-key">Stable key</FieldLabel>
          <Input
            id="def-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            disabled={editing}
            placeholder="order.shipped"
          />
          <FieldDescription>
            Lowercase, dotted, and immutable once created.
          </FieldDescription>
        </Field>

        {channel === "email" ? (
          <>
            <EmailContentFields
              from={from}
              subject={subject}
              text={text}
              html={html}
              onFromChange={setFrom}
              onSubjectChange={(value) =>
                updateEmailContent({ subject: value })
              }
              onTextChange={(value) => updateEmailContent({ text: value })}
              onHtmlChange={(value) => updateEmailContent({ html: value })}
            />
            <Field>
              <FieldLabel htmlFor="def-email-locale">Default locale</FieldLabel>
              <Input
                id="def-email-locale"
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
                placeholder="en"
              />
              <FieldDescription>
                Used when no locale is requested.
              </FieldDescription>
            </Field>
            <EmailLocalizedVariantsEditor
              variants={emailLocalizedVariants}
              onChange={setEmailLocalizedVariants}
            />
          </>
        ) : (
          <>
            <LocalizedVariantsEditor
              variants={localizedVariants}
              onChange={setLocalizedVariants}
            />
            <DefinitionDeliveryFields
              locale={locale}
              messageClass={messageClass}
              senderId={senderId}
              onLocaleChange={setLocale}
              onMessageClassChange={setMessageClass}
              onSenderIdChange={setSenderId}
            />
            <Field>
              <FieldLabel htmlFor="def-body">Message body</FieldLabel>
              <Textarea
                id="def-body"
                value={body}
                onChange={(event) => {
                  const nextBody = event.target.value;
                  setBody(nextBody);
                  setVariables((current) =>
                    variablesFromBody(nextBody, current),
                  );
                }}
                placeholder="Hi {{name}}, your order shipped."
              />
            </Field>
          </>
        )}

        <DefinitionSchemaEditor
          advanced={advancedSchema}
          schemaText={schemaText}
          fields={variables}
          onAdvancedChange={(advanced) => {
            if (advanced && builtSchema.schema) {
              setSchemaText(JSON.stringify(builtSchema.schema, null, 2));
            }
            if (!advanced) {
              const parsed = resolveAuthoringSchema(
                true,
                schemaText,
                variables,
              );
              if (!parsed.schema || !supportsVisualSchema(parsed.schema)) {
                setError(
                  parsed.error ??
                    "Schemas containing arrays must stay in advanced mode.",
                );
                return;
              }
              setVariables(variablesFromSchema(parsed.schema));
            }
            setError(null);
            setAdvancedSchema(advanced);
          }}
          onSchemaTextChange={setSchemaText}
          onFieldsChange={setVariables}
        />

        {channel === "email" ? (
          <EmailPreviewPanel
            subject={subject}
            text={text}
            html={html}
            schema={builtSchema.schema}
            fields={variables}
          />
        ) : (
          <DefinitionPreviewPanel
            body={body}
            schema={builtSchema.schema}
            fields={variables}
          />
        )}
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button onClick={submit} disabled={submitting}>
            {submitting
              ? "Creating…"
              : editing
                ? "Create version"
                : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

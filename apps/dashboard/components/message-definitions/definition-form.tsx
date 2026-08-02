"use client";

import {
  type ApplicationDto,
  type MessageChannel,
  type MessageDefinitionState,
  type SmsTemplate,
  stableKey,
} from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { Card, CardContent } from "@app/ui/components/ui/card";
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
import Link from "next/link";
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

export function DefinitionForm({
  initialTemplate,
  initialDefinition,
  initialApplicationId = "",
  applications,
  returnHref,
}: {
  initialTemplate?: SmsTemplate;
  initialDefinition?: MessageDefinitionState;
  initialApplicationId?: string;
  /** Loaded by the server page that renders this form — see DefinitionApplicationField. */
  applications: readonly ApplicationDto[];
  /** Where Cancel and a successful save return to. */
  returnHref: string;
}) {
  const router = useRouter();
  const initial = initialDefinitionDraft(initialTemplate, initialDefinition);
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
  // Locales the RELEASED version serves. Dropping one is a breaking change the API refuses
  // (`locale_removed`) — and switching the Default locale silently drops the old one, which reads as a
  // preference rather than an edit to the locale SET. The form has known this the whole time and said
  // nothing until submit, after the body had been rewritten; worse, the server's advice ("publish under
  // a new stable key") is the drastic option, when the intended move is almost always to KEEP the old
  // locale and add the new one alongside it.
  const releasedLocales = (() => {
    if (!initialDefinition) return [] as string[];
    const released = initialDefinition.releases[0];
    const version = initialDefinition.latest_version;
    if (!released || !version || released.version_id !== version.id) return [];
    const content = version.content as { locales?: Record<string, unknown> };
    return [
      version.default_locale,
      ...Object.keys(content.locales ?? {}),
    ].filter((entry, index, all) => entry && all.indexOf(entry) === index);
  })();
  const draftLocales = new Set(
    [
      locale.trim(),
      ...localizedVariants.map((variant) => variant.locale.trim()),
    ].filter(Boolean),
  );
  const droppedLocales = releasedLocales.filter(
    (released) => !draftLocales.has(released),
  );
  // Channel is chosen once and is immutable across versions (the API enforces it), so the selector
  // only appears when authoring a brand-new definition. A template is always SMS.
  const channelLocked = editing || Boolean(initialTemplate);

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
      router.push(returnHref);
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
    // Two columns: the fields you fill on the left, and what they PRODUCE on the right — the live
    // preview plus the submit. Stacked in one column the preview sat below the fold while you typed
    // and the submit button was another scroll past it, so the two things you check before saving were
    // never on screen with the thing you were editing. The rail is sticky for the same reason.
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      {/* Fields live ON a surface, not loose on the page background. A bare column of inputs has no
          edge, so it reads as page furniture rather than one object you are filling in — and it lines
          up with nothing else in the product, where every other group of content sits on a Card. */}
      <Card className="min-w-0">
        <CardContent className="flex min-w-0 flex-col gap-4">
          {/* No lede here: each page's own header already states what this form does, and in the edit
          flow this copy contradicted it by promising "the draft". The one fact worth repeating next
          to the fields is the token behaviour, which the Variables section states where it applies. */}
          {initialTemplate ? (
            <p className="text-muted-foreground text-sm">
              The original SMS template will remain unchanged.
            </p>
          ) : null}
          {!editing ? (
            <DefinitionApplicationField
              enabled={true}
              applications={applications}
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
                <FieldLabel htmlFor="def-email-locale">
                  Default locale
                </FieldLabel>
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
                defaultLocale={locale}
              />
              <DefinitionDeliveryFields
                locale={locale}
                messageClass={messageClass}
                senderId={senderId}
                onLocaleChange={setLocale}
                onMessageClassChange={setMessageClass}
                onSenderIdChange={setSenderId}
              />
              {droppedLocales.length > 0 ? (
                <p
                  role="alert"
                  className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong"
                >
                  This version would drop{" "}
                  <strong>{droppedLocales.join(", ")}</strong>, which the
                  released version serves — the API refuses that as a breaking
                  change. Use <em>Add locale</em> to keep{" "}
                  {droppedLocales.join(", ")} and add the new one alongside it.
                </p>
              ) : null}
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
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
        <Card>
          <CardContent>
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
          </CardContent>
        </Card>
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex items-center gap-2">
          <Button onClick={submit} disabled={submitting}>
            {submitting
              ? "Creating…"
              : editing
                ? "Create version"
                : "Create draft"}
          </Button>
          <Button variant="ghost" asChild>
            <Link href={returnHref}>Cancel</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

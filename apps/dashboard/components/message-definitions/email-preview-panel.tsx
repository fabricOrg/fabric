"use client";

import {
  type PreviewMessageResponse,
  previewMessageResponse,
  type VariableSchema,
} from "@app/contracts";
import { previewEmail } from "@app/domain";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import { Textarea } from "@app/ui/components/ui/textarea";
import { useMemo, useState } from "react";
import {
  type AuthoringVariable,
  samplePayload,
  supportsVisualSchema,
} from "./definition-authoring";

/**
 * Email counterpart of DefinitionPreviewPanel. Renders subject/text/html through the SAME pure
 * `previewEmail` core managed send uses (byte-size, tier, and price therefore equal a subsequent send),
 * and — for a released definition — offers a server round-trip that reads the API's `email_preview`.
 */
export function EmailPreviewPanel({
  subject,
  text,
  html,
  schema,
  fields,
  definitionKey,
}: {
  subject: string;
  text: string;
  html: string;
  schema: VariableSchema | null;
  fields: readonly AuthoringVariable[];
  definitionKey?: string;
}) {
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [sampleJson, setSampleJson] = useState("{}");
  const [releasedLocale, setReleasedLocale] = useState("");
  const [serverPreview, setServerPreview] =
    useState<PreviewMessageResponse | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const visual = schema ? supportsVisualSchema(schema) : true;
  const parsedAdvancedSample = useMemo(() => {
    if (visual) return { data: null, error: null };
    try {
      const data = JSON.parse(sampleJson) as unknown;
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        return { data: null, error: "Sample data must be a JSON object." };
      }
      return { data: data as Record<string, unknown>, error: null };
    } catch {
      return { data: null, error: "Sample data is not valid JSON." };
    }
  }, [sampleJson, visual]);
  const previewData = useMemo(() => {
    if (!visual && !parsedAdvancedSample.data) return null;
    return visual
      ? samplePayload(fields, samples)
      : (parsedAdvancedSample.data ?? {});
  }, [fields, parsedAdvancedSample.data, samples, visual]);
  const outcome = useMemo(() => {
    if (!schema || subject.trim().length === 0) return null;
    if (text.trim().length === 0 && html.trim().length === 0) return null;
    if (!previewData) return null;
    return previewEmail({
      subject,
      ...(text.trim().length > 0 ? { text } : {}),
      ...(html.trim().length > 0 ? { html } : {}),
      schema,
      data: previewData,
      currency: "GHS",
    });
  }, [subject, text, html, previewData, schema]);

  async function checkReleasedDefinition() {
    if (!definitionKey || !previewData) return;
    setChecking(true);
    setServerError(null);
    try {
      const response = await fetch(
        "/api/dashboard/message-definitions/preview",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            key: definitionKey,
            data: previewData,
            // No recipient field: email eligibility is not recipient-keyed (no consent/opt-out; the
            // sender is not_evaluated), and previewMessageRequest.to only accepts E.164 anyway.
            ...(releasedLocale ? { locale: releasedLocale } : {}),
          }),
        },
      );
      const payload = (await response.json()) as unknown;
      if (!response.ok)
        throw new Error("Couldn't check the released definition.");
      setServerPreview(previewMessageResponse.parse(payload));
    } catch (cause) {
      setServerPreview(null);
      setServerError(
        cause instanceof Error
          ? cause.message
          : "Couldn't check the released definition.",
      );
    } finally {
      setChecking(false);
    }
  }

  const serverEmail = serverPreview?.email_preview ?? null;

  return (
    <section
      className="space-y-3 rounded-lg border bg-muted/30 p-4"
      aria-label="Email preview"
    >
      <div>
        <h3 className="text-sm font-semibold">Live preview</h3>
        <p className="text-xs text-muted-foreground">
          Uses the same renderer, byte sizing, and size-tier pricing core as
          managed send. HTML values are escaped.
        </p>
      </div>
      {!visual ? (
        <Field>
          <FieldLabel htmlFor="advanced-email-preview-data">
            Sample data (JSON)
          </FieldLabel>
          <Textarea
            id="advanced-email-preview-data"
            className="font-mono text-xs"
            rows={6}
            value={sampleJson}
            onChange={(event) => setSampleJson(event.target.value)}
          />
        </Field>
      ) : fields.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((field) => (
            <Field key={field.id}>
              <FieldLabel htmlFor={`email-sample-${field.id}`}>
                {field.name}
              </FieldLabel>
              <Input
                id={`email-sample-${field.id}`}
                value={samples[field.id] ?? ""}
                onChange={(event) =>
                  setSamples((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }))
                }
                placeholder={samplePlaceholder(field)}
              />
            </Field>
          ))}
        </div>
      ) : null}
      {parsedAdvancedSample.error ? (
        <p role="alert" className="text-sm text-destructive">
          {parsedAdvancedSample.error}
        </p>
      ) : !outcome ? (
        <p className="text-sm text-muted-foreground">
          Add a subject, a body, and valid variables to see the preview.
        </p>
      ) : outcome.preview ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{outcome.preview.subject}</p>
          {outcome.preview.text !== null ? (
            <p className="whitespace-pre-wrap rounded-md bg-background p-3 text-sm">
              {outcome.preview.text}
            </p>
          ) : null}
          {outcome.preview.html !== null ? (
            <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
              <code>{outcome.preview.html}</code>
            </pre>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{outcome.preview.tier}</Badge>
            <Badge variant="outline">{outcome.preview.size_bytes} bytes</Badge>
            <Badge variant="outline">
              {outcome.preview.currency} {outcome.preview.cost_minor} minor
              units
            </Badge>
          </div>
        </div>
      ) : (
        <div role="alert" className="text-sm text-destructive">
          {outcome.blockers.map((blocker) => (
            <p key={`${blocker.path}:${blocker.code}`}>
              {blocker.path || "Message"}: {blocker.code.replaceAll("_", " ")}
            </p>
          ))}
        </div>
      )}
      {definitionKey ? (
        <div className="space-y-2 border-t pt-3">
          <div className="grid gap-2 sm:grid-cols-[8rem_auto] sm:items-end">
            <Field>
              <FieldLabel htmlFor={`email-released-locale-${definitionKey}`}>
                Locale
              </FieldLabel>
              <Input
                id={`email-released-locale-${definitionKey}`}
                value={releasedLocale}
                onChange={(event) => setReleasedLocale(event.target.value)}
                placeholder="Default"
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              disabled={checking || !previewData}
              onClick={checkReleasedDefinition}
            >
              {checking ? "Checking…" : "Check released sandbox"}
            </Button>
          </div>
          {serverError ? (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          ) : null}
          {serverPreview ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">
                {serverPreview.eligible ? "Eligible" : "Blocked"}
              </Badge>
              <Badge variant="outline">{serverPreview.resolved_locale}</Badge>
              {serverEmail ? (
                <>
                  <Badge variant="outline">{serverEmail.tier}</Badge>
                  <Badge variant="outline">
                    {serverEmail.currency} {serverEmail.cost_minor} minor units
                  </Badge>
                </>
              ) : null}
              {serverPreview.blockers.map((blocker) => (
                <Badge
                  key={`${blocker.path}:${blocker.code}`}
                  variant="destructive"
                >
                  {blocker.code.replaceAll("_", " ")}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function samplePlaceholder(field: AuthoringVariable): string {
  if (field.type === "boolean") return "true or false";
  if (field.type === "integer" || field.type === "number") return "1";
  return `Sample ${field.name.split(".").at(-1) ?? "value"}`;
}

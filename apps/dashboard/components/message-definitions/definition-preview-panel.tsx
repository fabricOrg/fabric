"use client";

import {
  type PreviewMessageResponse,
  previewMessageResponse,
  type VariableSchema,
} from "@app/contracts";
import { previewSms } from "@app/domain";
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

export function DefinitionPreviewPanel({
  body,
  schema,
  fields,
  definitionKey,
}: {
  body: string;
  schema: VariableSchema | null;
  fields: readonly AuthoringVariable[];
  definitionKey?: string;
}) {
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [sampleJson, setSampleJson] = useState("{}");
  const [recipient, setRecipient] = useState("");
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
    if (!schema || !body.trim()) return null;
    if (!previewData) return null;
    return previewSms({
      template: body,
      schema,
      data: previewData,
      currency: "GHS",
    });
  }, [body, previewData, schema]);

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
            ...(recipient ? { to: recipient } : {}),
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

  return (
    <section
      className="space-y-3 rounded-lg border bg-muted/30 p-4"
      aria-label="Message preview"
    >
      <div>
        <h3 className="text-sm font-semibold">Live preview</h3>
        <p className="text-xs text-muted-foreground">
          Uses the same renderer, encoding, segmentation, and pricing core as
          managed send.
        </p>
      </div>
      {!visual ? (
        <Field>
          <FieldLabel htmlFor="advanced-preview-data">
            Sample data (JSON)
          </FieldLabel>
          <Textarea
            id="advanced-preview-data"
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
              <FieldLabel htmlFor={`sample-${field.id}`}>
                {field.name}
              </FieldLabel>
              <Input
                id={`sample-${field.id}`}
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
          Add a message body and valid variables to see the preview.
        </p>
      ) : outcome.preview ? (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap rounded-md bg-background p-3 text-sm">
            {outcome.preview.body}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {outcome.preview.encoding.toUpperCase()}
            </Badge>
            <Badge variant="outline">{outcome.preview.length} characters</Badge>
            <Badge variant="outline">
              {outcome.preview.segments} segment
              {outcome.preview.segments === 1 ? "" : "s"}
            </Badge>
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
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
            <Field className="flex-1">
              <FieldLabel htmlFor={`recipient-${definitionKey}`}>
                Recipient for eligibility (optional)
              </FieldLabel>
              <Input
                id={`recipient-${definitionKey}`}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="+233201234567"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`released-locale-${definitionKey}`}>
                Locale
              </FieldLabel>
              <Input
                id={`released-locale-${definitionKey}`}
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
              <Badge variant="outline">
                Sender {serverPreview.sender.sender_id}:{" "}
                {serverPreview.sender.status}
              </Badge>
              <Badge variant="outline">{serverPreview.message_class}</Badge>
              <Badge variant="outline">{serverPreview.resolved_locale}</Badge>
              {serverPreview.warnings.map((warning) => (
                <Badge
                  key={`${warning.path}:${warning.code}`}
                  variant="secondary"
                >
                  {warning.code.replaceAll("_", " ")}
                </Badge>
              ))}
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

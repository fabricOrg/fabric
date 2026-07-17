"use client";

import type { VariableSchema } from "@app/contracts";
import { previewSms } from "@app/domain";
import { Badge } from "@app/ui/components/ui/badge";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import { useMemo, useState } from "react";
import { type AuthoringVariable, samplePayload } from "./definition-authoring";

export function DefinitionPreviewPanel({
  body,
  schema,
  fields,
}: {
  body: string;
  schema: VariableSchema | null;
  fields: readonly AuthoringVariable[];
}) {
  const [samples, setSamples] = useState<Record<string, string>>({});
  const outcome = useMemo(() => {
    if (!schema || !body.trim()) return null;
    return previewSms({
      template: body,
      schema,
      data: samplePayload(fields, samples),
      currency: "GHS",
    });
  }, [body, fields, samples, schema]);

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
      {fields.length > 0 ? (
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
      {!outcome ? (
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
    </section>
  );
}

function samplePlaceholder(field: AuthoringVariable): string {
  if (field.type === "boolean") return "true or false";
  if (field.type === "integer" || field.type === "number") return "1";
  return `Sample ${field.name.split(".").at(-1) ?? "value"}`;
}

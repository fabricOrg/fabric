"use client";

import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Switch } from "@app/ui/components/ui/switch";
import { Textarea } from "@app/ui/components/ui/textarea";
import type { AuthoringVariable } from "./definition-authoring";
import { VariableSchemaBuilder } from "./variable-schema-builder";

export function DefinitionSchemaEditor({
  advanced,
  schemaText,
  fields,
  onAdvancedChange,
  onSchemaTextChange,
  onFieldsChange,
}: {
  advanced: boolean;
  schemaText: string;
  fields: readonly AuthoringVariable[];
  onAdvancedChange: (advanced: boolean) => void;
  onSchemaTextChange: (value: string) => void;
  onFieldsChange: (fields: AuthoringVariable[]) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Variable schema</h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Switch
            checked={advanced}
            onCheckedChange={onAdvancedChange}
            aria-label="Use advanced variable schema editor"
          />
          Advanced
        </div>
      </div>
      {advanced ? (
        <Field>
          <FieldLabel htmlFor="def-schema">Portable schema JSON</FieldLabel>
          <Textarea
            id="def-schema"
            className="font-mono text-xs"
            rows={10}
            value={schemaText}
            onChange={(event) => onSchemaTextChange(event.target.value)}
          />
        </Field>
      ) : (
        <VariableSchemaBuilder fields={fields} onChange={onFieldsChange} />
      )}
    </section>
  );
}

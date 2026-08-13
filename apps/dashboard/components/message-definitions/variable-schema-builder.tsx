"use client";

import { Button } from "@app/ui/components/ui/button";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Switch } from "@app/ui/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import type {
  AuthoringVariable,
  AuthoringVariableType,
} from "./definition-authoring";

export function VariableSchemaBuilder({
  fields,
  onChange,
}: {
  fields: readonly AuthoringVariable[];
  onChange: (fields: AuthoringVariable[]) => void;
}) {
  function update(id: string, patch: Partial<AuthoringVariable>) {
    onChange(
      fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="variables-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="variables-heading" className="text-sm font-medium">
            Variables
          </h3>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange([
              ...fields,
              {
                id: crypto.randomUUID(),
                name: "",
                type: "string",
                required: false,
              },
            ])
          }
        >
          <Plus /> Add
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No variables. Type a token such as {"{{name}}"} in the message or add
          one manually.
        </p>
      ) : (
        <div className="space-y-2">
          {fields.map((field) => (
            <div
              key={field.id}
              className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto_auto]"
            >
              <Input
                aria-label="Variable name"
                value={field.name}
                onChange={(event) =>
                  update(field.id, { name: event.target.value })
                }
                placeholder="customer.name"
              />
              <Select
                value={field.type}
                onValueChange={(value) => {
                  if (isVariableType(value)) update(field.id, { type: value });
                }}
              >
                <SelectTrigger
                  aria-label={`Type for ${field.name || "variable"}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">Text</SelectItem>
                  <SelectItem value="integer">Integer</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="boolean">True / false</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 text-xs">
                <Switch
                  checked={field.required}
                  onCheckedChange={(checked) =>
                    update(field.id, { required: checked })
                  }
                  aria-label={`Require ${field.name || "variable"}`}
                />
                Required
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${field.name || "variable"}`}
                onClick={() =>
                  onChange(fields.filter((item) => item.id !== field.id))
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function isVariableType(value: string): value is AuthoringVariableType {
  return (
    value === "string" ||
    value === "integer" ||
    value === "number" ||
    value === "boolean"
  );
}

"use client";

import { stableKey, variableSchema } from "@app/contracts";
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
import { Textarea } from "@app/ui/components/ui/textarea";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface BffErrorPayload {
  error?: { message?: string };
}

const SCHEMA_PLACEHOLDER = `{
  "type": "object",
  "properties": { "name": { "type": "string" } },
  "required": ["name"]
}`;

/**
 * Author a draft definition (SDK-003 slice 6). The variable schema is entered as JSON and validated
 * client-side against the portable subset (@app/contracts variableSchema) before submit — the API
 * re-validates. A fuller visual schema builder is planned; this keeps authoring honest today.
 */
export function CreateDefinitionDialog({
  triggerLabel = "New definition",
}: {
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [body, setBody] = useState("");
  const [schemaText, setSchemaText] = useState(SCHEMA_PLACEHOLDER);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    if (!stableKey.safeParse(key.trim()).success) {
      setError("Enter a valid stable key, e.g. order.shipped.");
      return;
    }
    if (body.trim().length === 0) {
      setError("Enter the message body.");
      return;
    }
    let parsedSchema: unknown;
    try {
      parsedSchema = JSON.parse(schemaText);
    } catch {
      setError("Variable schema is not valid JSON.");
      return;
    }
    const schema = variableSchema.safeParse(parsedSchema);
    if (!schema.success) {
      setError(
        schema.error.issues[0]?.message ??
          "Variable schema is outside the supported subset.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/dashboard/message-definitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: key.trim(),
          content: { body: body.trim() },
          variable_schema: schema.data,
          default_locale: "en",
        }),
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as BffErrorPayload | null;
        throw new Error(
          payload?.error?.message ?? "Couldn't create the definition.",
        );
      }
      toast.success(`Created ${key.trim()}`, {
        description: "Publish it to sandbox to make it available.",
      });
      setOpen(false);
      setKey("");
      setBody("");
      setSchemaText(SCHEMA_PLACEHOLDER);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't create the definition.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message definition</DialogTitle>
          <DialogDescription>
            A stable key, its message body, and a variable schema. Tokens like{" "}
            {"{{name}}"} must be declared in the schema.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="def-key">Stable key</FieldLabel>
          <Input
            id="def-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="order.shipped"
          />
          <FieldDescription>
            Lowercase, dotted. Immutable once created.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="def-body">Message body</FieldLabel>
          <Textarea
            id="def-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {{name}}, your order shipped."
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="def-schema">Variable schema (JSON)</FieldLabel>
          <Textarea
            id="def-schema"
            className="font-mono text-xs"
            rows={7}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <DialogFooter>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

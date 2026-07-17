"use client";

import { type SmsTemplate, stableKey } from "@app/contracts";
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
import {
  type AuthoringVariable,
  buildVariableSchema,
  templateToDefinitionDraft,
  variablesFromBody,
} from "./definition-authoring";
import { DefinitionPreviewPanel } from "./definition-preview-panel";
import { VariableSchemaBuilder } from "./variable-schema-builder";

interface BffErrorPayload {
  error?: { message?: string };
}

interface DefinitionDraft {
  key: string;
  body: string;
  variables: AuthoringVariable[];
}

function initialDraft(template?: SmsTemplate): DefinitionDraft {
  return template
    ? templateToDefinitionDraft(template)
    : { key: "", body: "", variables: [] };
}

export function CreateDefinitionDialog({
  triggerLabel = "New definition",
  triggerVariant = "default",
  initialTemplate,
}: {
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost";
  initialTemplate?: SmsTemplate;
}) {
  const router = useRouter();
  const initial = initialDraft(initialTemplate);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(initial.key);
  const [body, setBody] = useState(initial.body);
  const [variables, setVariables] = useState(initial.variables);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const builtSchema = buildVariableSchema(variables);

  function reset(template?: SmsTemplate) {
    const draft = initialDraft(template);
    setKey(draft.key);
    setBody(draft.body);
    setVariables(draft.variables);
    setError(null);
  }

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
    if (!builtSchema.schema) {
      setError(builtSchema.error ?? "The variable schema is invalid.");
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
          variable_schema: builtSchema.schema,
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
        if (nextOpen && initialTemplate) reset(initialTemplate);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New message definition</DialogTitle>
          <DialogDescription>
            Review the stable key, message, variables, and live output before
            creating the draft.
            {initialTemplate
              ? " The original SMS template will remain unchanged."
              : " Tokens such as {{name}} are detected automatically."}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="def-key">Stable key</FieldLabel>
          <Input
            id="def-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="order.shipped"
          />
          <FieldDescription>
            Lowercase, dotted, and immutable once created.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="def-body">Message body</FieldLabel>
          <Textarea
            id="def-body"
            value={body}
            onChange={(event) => {
              const nextBody = event.target.value;
              setBody(nextBody);
              setVariables((current) => variablesFromBody(nextBody, current));
            }}
            placeholder="Hi {{name}}, your order shipped."
          />
        </Field>
        <VariableSchemaBuilder fields={variables} onChange={setVariables} />
        <DefinitionPreviewPanel
          body={body}
          schema={builtSchema.schema}
          fields={variables}
        />
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

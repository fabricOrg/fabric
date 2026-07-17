"use client";

import {
  type MessageClass,
  type MessageDefinitionState,
  type SmsTemplate,
  stableKey,
  variableSchema,
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
import { Textarea } from "@app/ui/components/ui/textarea";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  type AuthoringVariable,
  buildVariableSchema,
  supportsVisualSchema,
  templateToDefinitionDraft,
  variablesFromBody,
  variablesFromSchema,
} from "./definition-authoring";
import { DefinitionDeliveryFields } from "./definition-delivery-fields";
import { DefinitionPreviewPanel } from "./definition-preview-panel";
import { DefinitionSchemaEditor } from "./definition-schema-editor";

interface BffErrorPayload {
  error?: { message?: string };
}

interface DefinitionDraft {
  key: string;
  body: string;
  variables: AuthoringVariable[];
  locale: string;
  schemaText: string;
  advancedSchema: boolean;
  messageClass: MessageClass;
  senderId: string;
}

function initialDraft(
  template?: SmsTemplate,
  definition?: MessageDefinitionState,
): DefinitionDraft {
  if (definition?.latest_version) {
    return {
      key: definition.definition.key,
      body: definition.latest_version.content.body,
      variables: variablesFromSchema(definition.latest_version.variable_schema),
      locale: definition.latest_version.default_locale,
      schemaText: JSON.stringify(
        definition.latest_version.variable_schema,
        null,
        2,
      ),
      advancedSchema: !supportsVisualSchema(
        definition.latest_version.variable_schema,
      ),
      messageClass: definition.latest_version.content.class,
      senderId: definition.sender_bindings[0]?.sender_id ?? "",
    };
  }
  if (template) {
    return {
      ...templateToDefinitionDraft(template),
      locale: "en",
      schemaText: "",
      advancedSchema: false,
      messageClass: template.class,
      senderId: "",
    };
  }
  return {
    key: "",
    body: "",
    variables: [],
    locale: "en",
    schemaText: "",
    advancedSchema: false,
    messageClass: "transactional",
    senderId: "",
  };
}

export function CreateDefinitionDialog({
  triggerLabel = "New definition",
  triggerVariant = "default",
  initialTemplate,
  initialDefinition,
}: {
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost";
  initialTemplate?: SmsTemplate;
  initialDefinition?: MessageDefinitionState;
}) {
  const router = useRouter();
  const initial = initialDraft(initialTemplate, initialDefinition);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(initial.key);
  const [body, setBody] = useState(initial.body);
  const [variables, setVariables] = useState(initial.variables);
  const [locale, setLocale] = useState(initial.locale);
  const [schemaText, setSchemaText] = useState(initial.schemaText);
  const [advancedSchema, setAdvancedSchema] = useState(initial.advancedSchema);
  const [messageClass, setMessageClass] = useState(initial.messageClass);
  const [senderId, setSenderId] = useState(initial.senderId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const builtSchema = resolveSchema(advancedSchema, schemaText, variables);

  function reset(template?: SmsTemplate, definition?: MessageDefinitionState) {
    const draft = initialDraft(template, definition);
    setKey(draft.key);
    setBody(draft.body);
    setVariables(draft.variables);
    setLocale(draft.locale);
    setSchemaText(draft.schemaText);
    setAdvancedSchema(draft.advancedSchema);
    setMessageClass(draft.messageClass);
    setSenderId(draft.senderId);
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
    if (locale.trim().length < 2) {
      setError("Enter a valid default locale, such as en or en-GH.");
      return;
    }
    if (!initialDefinition && senderId.trim().length === 0) {
      setError("Choose the sandbox sender for this definition.");
      return;
    }
    if (!builtSchema.schema) {
      setError(builtSchema.error ?? "The variable schema is invalid.");
      return;
    }
    setSubmitting(true);
    try {
      const editing = Boolean(initialDefinition);
      const url = initialDefinition
        ? `/api/dashboard/message-definitions/${initialDefinition.definition.id}/versions`
        : "/api/dashboard/message-definitions";
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(editing ? {} : { key: key.trim() }),
          content: { body: body.trim(), class: messageClass },
          variable_schema: builtSchema.schema,
          default_locale: locale.trim(),
          ...(editing ? {} : { sender_id: senderId.trim() }),
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
      toast.success(
        editing
          ? `Created a new ${key.trim()} version`
          : `Created ${key.trim()}`,
        {
          description: "Publish the latest version to update sandbox.",
        },
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
          {initialDefinition ? (
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
            {initialDefinition
              ? "Create a new version"
              : "New message definition"}
          </DialogTitle>
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
            disabled={Boolean(initialDefinition)}
            placeholder="order.shipped"
          />
          <FieldDescription>
            Lowercase, dotted, and immutable once created.
          </FieldDescription>
        </Field>
        <DefinitionDeliveryFields
          locale={locale}
          messageClass={messageClass}
          senderId={senderId}
          senderLocked={Boolean(initialDefinition)}
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
              setVariables((current) => variablesFromBody(nextBody, current));
            }}
            placeholder="Hi {{name}}, your order shipped."
          />
        </Field>
        <DefinitionSchemaEditor
          advanced={advancedSchema}
          schemaText={schemaText}
          fields={variables}
          onAdvancedChange={(advanced) => {
            if (advanced && builtSchema.schema) {
              setSchemaText(JSON.stringify(builtSchema.schema, null, 2));
            }
            if (!advanced) {
              const parsed = resolveSchema(true, schemaText, variables);
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
        <DefinitionPreviewPanel
          body={body}
          schema={builtSchema.schema}
          fields={variables}
        />
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button onClick={submit} disabled={submitting}>
            {submitting
              ? "Creating…"
              : initialDefinition
                ? "Create version"
                : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function resolveSchema(
  advanced: boolean,
  schemaText: string,
  variables: readonly AuthoringVariable[],
) {
  if (!advanced) return buildVariableSchema(variables);
  try {
    const parsed = variableSchema.safeParse(JSON.parse(schemaText));
    return parsed.success
      ? { schema: parsed.data, error: null }
      : {
          schema: null,
          error:
            parsed.error.issues[0]?.message ??
            "The variable schema is invalid.",
        };
  } catch {
    return { schema: null, error: "The variable schema is not valid JSON." };
  }
}

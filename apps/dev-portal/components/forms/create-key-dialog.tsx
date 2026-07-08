"use client";

import type { ApiKey, ApiKeyEnv } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
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
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { FieldError, fieldInvalid } from "@app/ui/components/ui/form";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useForm } from "@tanstack/react-form";
import { Check, Copy, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toastApiError } from "@/lib/error-toast";
import { AVAILABLE_SCOPES } from "@/lib/fixtures";
import { createApiKey } from "@/lib/mock-api";
import { schema } from "./create-key-dialog.schema";

/**
 * Create-key flow. Two phases in one dialog: (1) form (name · env · scopes) → (2) ONCE-ONLY reveal of
 * the full secret with an unmistakable "you won't see this again" warning, copy, then masked forever.
 */
export function CreateKeyDialog({
  onCreated,
}: {
  onCreated: (key: ApiKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm({
    defaultValues: {
      name: "",
      env: "test" as ApiKeyEnv,
      scopes: ["sms:send"] as string[],
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      try {
        const result = await createApiKey({
          name: value.name.trim(),
          env: value.env,
          scopes: value.scopes,
        });
        setSecret(result.secret);
        onCreated(result.key);
      } catch (envelope) {
        toastApiError(envelope);
      }
    },
  });

  function reset() {
    form.reset();
    setSecret(null);
    setCopied(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          Create key
        </Button>
      </DialogTrigger>
      <DialogContent>
        {secret === null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
            noValidate
          >
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Name it, pick an environment and scopes. The secret is shown
                once after creation.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <form.Field name="name">
                {(field) => {
                  const invalid = fieldInvalid(field);
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="key-name">Name</FieldLabel>
                      <Input
                        id="key-name"
                        placeholder="e.g. Production API"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        aria-invalid={invalid || undefined}
                      />
                      <FieldError field={field} />
                    </Field>
                  );
                }}
              </form.Field>

              <form.Field name="env">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="key-env">Environment</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v as ApiKeyEnv)}
                    >
                      <SelectTrigger id="key-env">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="test">
                          Test — sandbox, never charges or sends
                        </SelectItem>
                        <SelectItem value="live">
                          Live — real money and delivery
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>

              <form.Field name="scopes">
                {(field) => {
                  const invalid = fieldInvalid(field);
                  const selected = field.state.value;
                  const toggleScope = (s: string) =>
                    field.handleChange(
                      selected.includes(s)
                        ? selected.filter((x) => x !== s)
                        : [...selected, s],
                    );
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel>Scopes</FieldLabel>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_SCOPES.map((s) => {
                          const on = selected.includes(s);
                          return (
                            <Button
                              key={s}
                              type="button"
                              size="sm"
                              variant={on ? "default" : "outline"}
                              aria-pressed={on}
                              className="font-mono"
                              onClick={() => toggleScope(s)}
                            >
                              {on ? <Check data-icon="inline-start" /> : null}
                              {s}
                            </Button>
                          );
                        })}
                      </div>
                      <FieldError field={field} />
                    </Field>
                  );
                }}
              </form.Field>
            </div>
            <DialogFooter>
              <form.Subscribe
                selector={(s) => ({
                  canSubmit: s.canSubmit,
                  isSubmitting: s.isSubmitting,
                })}
              >
                {({ canSubmit, isSubmitting }) => (
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? "Creating…" : "Create key"}
                  </Button>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy your secret key now</DialogTitle>
              <DialogDescription>
                This is the only time you'll see the full key. Store it
                somewhere safe.
              </DialogDescription>
            </DialogHeader>
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>You won't be able to see this again</AlertTitle>
              <AlertDescription>
                After you close this dialog only the key's prefix is shown. If
                you lose it, revoke and create a new one.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={secret}
                className="font-mono text-sm"
                aria-label="Secret API key"
              />
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(secret);
                  setCopied(true);
                }}
                aria-label="Copy secret key"
              >
                {copied ? (
                  <Check data-icon="inline-start" />
                ) : (
                  <Copy data-icon="inline-start" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

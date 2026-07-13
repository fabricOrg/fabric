"use client";

import type { ApiKeyEnv } from "@app/contracts";
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
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { toastApiError } from "@/lib/error-toast";

/** Scopes a customer key can carry today (the data-plane routes that check them). */
const AVAILABLE_SCOPES = [
  "sms:send",
  "sms:read",
  "email:send",
  "email:read",
  "wallet:read",
] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Name your key."),
  scopes: z.array(z.string()).min(1, "Pick at least one scope."),
  expiresInDays: z.number(), // 0 = never expires
});

/** Key lifetime options. 0 = never — a long-lived key is a deliberate choice, not the only one. */
const EXPIRY_OPTIONS = [
  { value: "0", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
] as const;

interface CreatedKey {
  secret?: unknown;
}

/**
 * Create-key flow (W-B), scoped to ONE application-environment (ADR-0004). The env is fixed by the
 * section the button lives in (Sandbox or Live) — not chosen here. Two phases in one dialog: (1) form
 * (name · scopes) → (2) ONCE-ONLY reveal of the full secret with an unmistakable warning + copy.
 */
export function CreateApiKeyDialog({
  applicationId,
  env,
  disabled = false,
}: {
  applicationId: string;
  env: ApiKeyEnv;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm({
    defaultValues: {
      name: "",
      scopes: ["sms:send"] as string[],
      expiresInDays: 0,
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      try {
        const response = await fetch("/api/api-keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: value.name.trim(),
            env,
            scopes: value.scopes,
            application_id: applicationId,
            expires_in_days: value.expiresInDays,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | (CreatedKey & Record<string, unknown>)
          | null;
        if (!response.ok) {
          toastApiError(payload);
          return;
        }
        setSecret(typeof payload?.secret === "string" ? payload.secret : "");
      } catch {
        toastApiError(null);
      }
    },
  });

  function close() {
    setOpen(false);
    form.reset();
    setSecret(null);
    setCopied(false);
    router.refresh(); // re-SSR so the new key (prefix only) appears authoritatively
  }

  const envLabel = env === "live" ? "live" : "test";

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
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
              <DialogTitle>Create {envLabel} key</DialogTitle>
              <DialogDescription>
                {env === "live"
                  ? "A live key spends real money and delivers to carriers."
                  : "A test key is sandboxed — it never charges or sends."}{" "}
                The secret is shown once after creation.
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

              <form.Field name="expiresInDays">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="key-expiry">Expires</FieldLabel>
                    <Select
                      value={String(field.state.value)}
                      onValueChange={(v) => field.handleChange(Number(v))}
                    >
                      <SelectTrigger id="key-expiry">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
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
                This is the only time you&apos;ll see the full key. Store it
                somewhere safe.
              </DialogDescription>
            </DialogHeader>
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>You won&apos;t be able to see this again</AlertTitle>
              <AlertDescription>
                After you close this dialog only the key&apos;s prefix is shown.
                If you lose it, revoke and create a new one.
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
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

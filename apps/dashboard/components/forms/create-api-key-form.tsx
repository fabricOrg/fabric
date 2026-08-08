"use client";

import {
  type ApiKeyEnv,
  type ApiKeyScope,
  apiKeyScopes,
  apiKeyScopeValues,
} from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
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
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { toastApiError } from "@/lib/error-toast";

const SCOPE_DETAILS: Record<
  ApiKeyScope,
  { readonly label: string; readonly description: string }
> = {
  "sms:send": {
    label: "Send and manage SMS",
    description: "Send messages and manage templates, senders, and consent.",
  },
  "sms:read": {
    label: "Read SMS activity",
    description: "Read messages, templates, senders, and consent records.",
  },
  "email:send": {
    label: "Send email",
    description: "Send transactional email through this environment.",
  },
  "email:read": {
    label: "Read email activity",
    description: "Read email messages, delivery records, and content previews.",
  },
  "whatsapp:send": {
    label: "Send WhatsApp",
    description: "Send approved WhatsApp templates through this environment.",
  },
  "wallet:read": {
    label: "Wallet and payments",
    description: "Read wallet data and initiate payment transaction flows.",
  },
  "request_logs:read": {
    label: "Read request logs",
    description: "Inspect this application's API request history.",
  },
  "api_keys:read": {
    label: "Read webhooks",
    description: "List webhook endpoints for this application.",
  },
  "api_keys:write": {
    label: "Manage webhooks",
    description: "Create and remove webhook endpoints.",
  },
  "definitions:read": {
    label: "Read definition contracts",
    description:
      "Generate typed keys, payloads, channels, and locales for this environment.",
  },
  "messages:send": {
    label: "Send managed messages",
    description: "Send released definitions by stable key in this environment.",
  },
  "messages:read": {
    label: "Read managed deliveries",
    description: "Retrieve managed delivery status, attempts, and cost.",
  },
};

const schema = z.object({
  name: z.string().trim().min(1, "Name your key."),
  scopes: apiKeyScopes,
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
 * Create-key flow (W-B), scoped to ONE application-environment (ADR-0004), rendered on its own page
 * (the permission grid is too much for a modal). Two phases: (1) form (name · scopes · expiry) →
 * (2) ONCE-ONLY reveal of the full secret. `backHref` is where "Done"/"Cancel" return to.
 */
export function CreateApiKeyForm({
  applicationId,
  env,
  backHref,
  playgroundUrl,
}: {
  applicationId: string;
  env: ApiKeyEnv;
  backHref: string;
  /** Hosted playground URL — when set, the secret reveal offers a "try it" link. */
  playgroundUrl?: string;
}) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm({
    defaultValues: {
      name: "",
      scopes: ["sms:send"] as ApiKeyScope[],
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

  function done() {
    router.push(backHref);
    router.refresh(); // re-SSR so the new key (prefix only) appears authoritatively
  }

  if (secret !== null) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Copy your secret key now</h2>
          <p className="text-sm text-muted-foreground">
            This is the only time you&apos;ll see the full key. Store it
            somewhere safe.
          </p>
        </div>
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>You won&apos;t be able to see this again</AlertTitle>
          <AlertDescription>
            After you leave this page only the key&apos;s prefix is shown. If
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
        <div className="flex flex-wrap gap-2">
          <Button onClick={done}>Done</Button>
          {playgroundUrl ? (
            <Button variant="outline" asChild>
              <a href={playgroundUrl} target="_blank" rel="noreferrer">
                Try it in the playground
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      noValidate
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_260px]"
    >
      {/* Main column — name + the permission grid. */}
      <div className="flex flex-col gap-6">
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
            const toggleScope = (s: ApiKeyScope) =>
              field.handleChange(
                selected.includes(s)
                  ? selected.filter((x) => x !== s)
                  : [...selected, s],
              );
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel>Permissions</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  {apiKeyScopeValues.map((s) => {
                    const on = selected.includes(s);
                    const detail = SCOPE_DETAILS[s];
                    return (
                      <Button
                        key={s}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        className="h-auto min-h-16 justify-start whitespace-normal px-3 py-2 text-left"
                        onClick={() => toggleScope(s)}
                      >
                        {on ? <Check data-icon="inline-start" /> : null}
                        <span className="flex flex-col items-start gap-0.5">
                          <span>{detail.label}</span>
                          <span
                            className={
                              on
                                ? "text-xs text-primary-foreground/80"
                                : "text-xs text-muted-foreground"
                            }
                          >
                            {detail.description}
                          </span>
                          <span
                            className={
                              on
                                ? "font-mono text-xs text-primary-foreground/80"
                                : "font-mono text-xs text-muted-foreground"
                            }
                          >
                            {s}
                          </span>
                        </span>
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

      {/* Side panel — lifespan + the primary actions, sticky beside the grid. */}
      <aside className="flex flex-col gap-6 rounded-lg border bg-card p-4 lg:sticky lg:top-6">
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

        <div className="flex flex-col gap-2 border-t pt-4">
          <form.Subscribe
            selector={(s) => ({
              canSubmit: s.canSubmit,
              isSubmitting: s.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                type="submit"
                className="w-full"
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting ? "Creating…" : "Create key"}
              </Button>
            )}
          </form.Subscribe>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => router.push(backHref)}
          >
            Cancel
          </Button>
        </div>
      </aside>
    </form>
  );
}

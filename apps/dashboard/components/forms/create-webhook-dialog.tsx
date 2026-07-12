"use client";

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
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { FieldError, fieldInvalid } from "@app/ui/components/ui/form";
import { Input } from "@app/ui/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { Check, Copy, Plus, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { toastApiError } from "@/lib/error-toast";

interface CreatedWebhook {
  secret?: unknown;
}

// Form shape (description is a required string here — empty allowed — matching the inputs; the API
// contract treats an omitted description as null, so we drop it when blank on submit).
const formSchema = z.object({
  url: z
    .string()
    .url()
    .max(2000)
    .refine((u) => u.startsWith("https://") || u.startsWith("http://"), {
      message: "Enter a valid http(s) URL.",
    }),
  description: z.string().max(200),
});

/**
 * Register a webhook endpoint (W-B), scoped to ONE application-environment (ADR-0004). Two phases:
 * (1) form (url · optional description) → (2) ONCE-ONLY reveal of the signing secret (whsec_) used to
 * verify the `fabric-signature` header, with copy. The env is fixed by the section it lives in.
 */
export function CreateWebhookDialog({
  applicationId,
  env,
}: {
  applicationId: string;
  env: "sandbox" | "live";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm({
    defaultValues: { url: "", description: "" },
    validators: { onChange: formSchema },
    onSubmit: async ({ value }) => {
      try {
        const response = await fetch("/api/webhooks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: value.url.trim(),
            ...(value.description.trim()
              ? { description: value.description.trim() }
              : {}),
            application_id: applicationId,
            env,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | (CreatedWebhook & Record<string, unknown>)
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
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus data-icon="inline-start" />
          Add endpoint
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
              <DialogTitle>Add a webhook endpoint</DialogTitle>
              <DialogDescription>
                We&apos;ll POST signed event envelopes to this URL. The signing
                secret is shown once after creation.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <form.Field name="url">
                {(field) => {
                  const invalid = fieldInvalid(field);
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="webhook-url">
                        Endpoint URL
                      </FieldLabel>
                      <Input
                        id="webhook-url"
                        placeholder="https://api.example.com/webhooks/fabric"
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
              <form.Field name="description">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="webhook-description">
                      Description
                    </FieldLabel>
                    <Input
                      id="webhook-description"
                      placeholder="Optional — what this endpoint is for"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    <FieldDescription>Up to 200 characters.</FieldDescription>
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
                    {isSubmitting ? "Adding…" : "Add endpoint"}
                  </Button>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy your signing secret now</DialogTitle>
              <DialogDescription>
                This is the only time you&apos;ll see the full secret. Use it to
                verify the <code>fabric-signature</code> header.
              </DialogDescription>
            </DialogHeader>
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>You won&apos;t be able to see this again</AlertTitle>
              <AlertDescription>
                After you close this dialog only the secret&apos;s prefix is
                shown. If you lose it, delete the endpoint and add a new one.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={secret}
                className="font-mono text-sm"
                aria-label="Webhook signing secret"
              />
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(secret);
                  setCopied(true);
                }}
                aria-label="Copy signing secret"
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

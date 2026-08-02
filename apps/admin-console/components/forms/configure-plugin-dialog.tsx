"use client";

import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  configurePlugin,
  type PluginInstance,
  VENDOR_CREDENTIAL_FIELDS,
} from "@/lib/client/plugins-api";

/** Narrow an instance's mode for the field specs' `derivedFromMode`. */
function modeOf(mode: string | null | undefined): "sandbox" | "live" {
  return mode === "live" ? "live" : "sandbox";
}

/**
 * Say what actually went wrong.
 *
 * Our own errors arrive as `{ error: { message } }`. An UNCAUGHT server error does not — Nest
 * returns `{ statusCode, message: "Internal server error" }`, which carries no cause at all. The
 * overwhelmingly likely cause here is a missing or too-short PLUGIN_MASTER_KEY, because that is the
 * one dependency this endpoint has that throws rather than returning a structured error, so name it
 * instead of leaving an operator to guess.
 */
function installFailureMessage(thrown: unknown): string {
  const structured = (thrown as { error?: { message?: string } })?.error
    ?.message;
  if (structured) return structured;
  const status = (thrown as { statusCode?: number })?.statusCode;
  if (status !== undefined && status >= 500) {
    return "The server failed while sealing the credential. This is usually PLUGIN_MASTER_KEY being unset or shorter than 32 characters on the API host — check the API logs.";
  }
  return "The credential could not be installed.";
}

/**
 * Install or rotate a provider credential (ADR-0011 §1). Fields come from the vendor's own declared
 * shape; the api re-validates against the adapter's `configSchema` regardless.
 *
 * WRITE-ONLY. Existing values are never rendered — they are unreadable once sealed. Rotation shows
 * the same empty form, because that is honestly what it is: installing a new version, not editing
 * the old one.
 */
export function ConfigurePluginDialog({
  instance,
  open,
  onOpenChange,
  onConfigured,
}: {
  instance: PluginInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigured?: () => void;
}) {
  const ids = useId();
  const [error, setError] = useState<string | null>(null);

  const fields = instance
    ? (VENDOR_CREDENTIAL_FIELDS[instance.vendor] ?? [
        // Unknown vendor: assume the single field IS the secret and mask it. Failing closed on
        // masking is the right default — a needlessly hidden value costs nothing.
        { name: "apiKey", label: "API key", required: true, secret: true },
      ])
    : [];

  const form = useForm({
    defaultValues: {} as Record<string, string>,
    onSubmit: async ({ value }) => {
      if (!instance) return;
      setError(null);
      // Drop blanks so an untouched optional field is absent rather than stored as "" — but a
      // mode-derived field is never "untouched": it always has a definite value the operator can read
      // on screen, so it must always be submitted. Omitting it is how a live instance ends up without
      // sandbox='false' and is rejected for a setting the form appeared to have made.
      const credential = Object.fromEntries(
        fields
          .map((spec) => [
            spec.name,
            spec.derivedFromMode
              ? spec.derivedFromMode(modeOf(instance.mode))
              : (value[spec.name]?.trim() ?? ""),
          ])
          .filter(([, v]) => v !== ""),
      );
      try {
        const { fingerprint, version } = await configurePlugin(
          instance.id,
          credential,
        );
        onOpenChange(false);
        form.reset();
        onConfigured?.();
        toast.success(`${instance.label} credentials installed`, {
          description: `Version ${version} · fingerprint ${fingerprint}`,
        });
      } catch (thrown) {
        setError(installFailureMessage(thrown));
      }
    },
  });

  const isLive = instance?.mode === "live";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {instance?.credential_fingerprint ? "Rotate" : "Configure"}{" "}
              {instance?.label}
            </DialogTitle>
            <DialogDescription>
              {isLive
                ? "These credentials reach a real carrier. Sends will cost money and arrive on real phones."
                : "Sandbox credentials. Nothing here reaches a carrier."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {instance?.credential_fingerprint ? (
              <p className="text-muted-foreground text-sm">
                A credential is already installed (fingerprint{" "}
                <span className="font-mono">
                  {instance.credential_fingerprint}
                </span>
                ). Saving installs a new version; the previous one stops being
                used immediately.
              </p>
            ) : null}

            {fields.map((spec) => (
              <form.Field key={spec.name} name={spec.name}>
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${ids}-${spec.name}`}>
                      {spec.label}
                      {spec.required || spec.derivedFromMode
                        ? ""
                        : " (optional)"}
                    </FieldLabel>
                    {spec.derivedFromMode ? (
                      // Stated, not asked: the instance's mode already decides this, so a control
                      // here could only be set to the one value that gets refused.
                      <p className="flex flex-wrap items-baseline gap-x-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                        <span>
                          {spec.derivedNote?.(modeOf(instance?.mode)) ??
                            spec.derivedFromMode(modeOf(instance?.mode))}
                        </span>
                        <span className="font-mono text-muted-foreground text-xs">
                          {spec.name}=
                          {spec.derivedFromMode(modeOf(instance?.mode))}
                        </span>
                      </p>
                    ) : (
                      <Input
                        id={`${ids}-${spec.name}`}
                        // Masked from the field's own metadata, not a hard-coded name — keying on
                        // `apiKey` left Paystack's secretKey rendering in plain text.
                        type={spec.secret ? "password" : "text"}
                        value={field.state.value ?? ""}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        className="font-mono"
                        autoComplete="off"
                      />
                    )}
                    {spec.hint ? (
                      <FieldDescription>{spec.hint}</FieldDescription>
                    ) : null}
                  </Field>
                )}
              </form.Field>
            ))}

            <p className="text-muted-foreground text-xs">
              Stored encrypted under the platform master key. It cannot be read
              back from anywhere afterwards — only replaced.
            </p>

            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                </DialogClose>
              )}
            </form.Subscribe>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" loading={isSubmitting}>
                  Install credentials
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

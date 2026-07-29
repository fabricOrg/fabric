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
import { Switch } from "@app/ui/components/ui/switch";
import { useForm } from "@tanstack/react-form";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  configurePlugin,
  type PluginInstance,
  VENDOR_CREDENTIAL_FIELDS,
} from "@/lib/client/plugins-api";

/**
 * The only value a given mode will accept. `credentialModeViolation` on the api rejects a live
 * instance without sandbox='false' and a sandbox instance with it, so the switch opens already
 * correct instead of making staff discover the rule by being refused.
 */
function booleanDefault(mode: string | null | undefined): string {
  return mode === "live" ? "false" : "true";
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
      // switch is never "untouched": it always shows a definite position, so it must always submit
      // the value the operator can see. Leaving it out is how a live instance ends up without
      // sandbox='false' and gets rejected for a setting the form appeared to have made.
      const credential = Object.fromEntries(
        fields
          .map((spec) => [
            spec.name,
            spec.boolean
              ? (value[spec.name] ?? booleanDefault(instance.mode))
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
                      {spec.required || spec.boolean ? "" : " (optional)"}
                    </FieldLabel>
                    {spec.boolean ? (
                      // A two-value enum is a switch, not a spelling test. Typing the literal
                      // "false" invited a typo that would have been accepted as "sandboxed" and
                      // silently never delivered anything.
                      <Switch
                        id={`${ids}-${spec.name}`}
                        checked={
                          (field.state.value ??
                            booleanDefault(instance?.mode)) !== "false"
                        }
                        onCheckedChange={(on) =>
                          field.handleChange(on ? "true" : "false")
                        }
                      />
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

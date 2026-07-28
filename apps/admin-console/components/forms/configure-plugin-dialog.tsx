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
        { name: "apiKey", label: "API key", required: true },
      ])
    : [];

  const form = useForm({
    defaultValues: {} as Record<string, string>,
    onSubmit: async ({ value }) => {
      if (!instance) return;
      setError(null);
      // Drop blanks so an untouched optional field is absent rather than stored as "".
      const credential = Object.fromEntries(
        Object.entries(value).filter(([, v]) => v?.trim()),
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
        const message =
          (thrown as { error?: { message?: string } })?.error?.message ??
          "The credential could not be installed.";
        setError(message);
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
                      {spec.required ? "" : " (optional)"}
                    </FieldLabel>
                    <Input
                      id={`${ids}-${spec.name}`}
                      type={spec.name === "apiKey" ? "password" : "text"}
                      value={field.state.value ?? ""}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      className="font-mono"
                      autoComplete="off"
                    />
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

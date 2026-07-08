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
import { useId } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { PluginInstance } from "@/lib/client/plugins-api";

/**
 * Credential config for a platform plugin instance. Mock — TODO(BFF): store creds in Vault + verify.
 * Live mode is a redline (real spend/sends): sandbox is the only mode here; going live is a separate,
 * human-approved step with real credentials.
 */
const schema = z.object({
  key: z.string().trim().min(1),
  secret: z.string().trim().min(1),
});

export function ConfigurePluginDialog({
  instance,
  open,
  onOpenChange,
}: {
  instance: PluginInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ids = useId();

  const form = useForm({
    defaultValues: { key: "", secret: "" },
    validators: { onChange: schema },
    onSubmit: async () => {
      if (!instance) return;
      // Mock persist — TODO(BFF): store creds in Vault + verify against the provider.
      await new Promise((resolve) => setTimeout(resolve, 400));
      onOpenChange(false);
      form.reset();
      toast.success(`${instance.vendor} configured (sandbox)`, {
        description: "Test credentials saved. Enable it to route traffic.",
      });
    },
  });

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
            <DialogTitle>Configure {instance?.vendor}</DialogTitle>
            <DialogDescription>
              Sandbox / test credentials only. Going live (real spend &amp;
              sends) is a separate, approved step.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <form.Field name="key">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${ids}-key`}>API key</FieldLabel>
                  <Input
                    id={`${ids}-key`}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="pk_test_…"
                    className="font-mono"
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="secret">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${ids}-secret`}>API secret</FieldLabel>
                  <Input
                    id={`${ids}-secret`}
                    type="password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="sk_test_…"
                    className="font-mono"
                  />
                  <FieldDescription>
                    Stored encrypted in Vault; never shown again after saving.
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
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
            <form.Subscribe
              selector={(s) => [s.canSubmit, s.isSubmitting] as const}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  loading={isSubmitting}
                  disabled={!canSubmit}
                >
                  Save credentials
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

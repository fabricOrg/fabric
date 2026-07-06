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
import { useId, useState } from "react";
import { toast } from "sonner";
import type { PluginInstance } from "@/lib/client/plugins-api";

/**
 * Credential config for a platform plugin instance. Mock — TODO(BFF): store creds in Vault + verify.
 * Live mode is a redline (real spend/sends): sandbox is the only mode here; going live is a separate,
 * human-approved step with real credentials.
 */
export function ConfigurePluginDialog({
  instance,
  open,
  onOpenChange,
}: {
  instance: PluginInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const ids = useId();

  function save() {
    if (!instance) return;
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      onOpenChange(false);
      setKey("");
      setSecret("");
      toast.success(`${instance.vendor} configured (sandbox)`, {
        description: "Test credentials saved. Enable it to route traffic.",
      });
    }, 400);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure {instance?.vendor}</DialogTitle>
          <DialogDescription>
            Sandbox / test credentials only. Going live (real spend &amp; sends)
            is a separate, approved step.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <Field>
            <FieldLabel htmlFor={`${ids}-key`}>API key</FieldLabel>
            <Input
              id={`${ids}-key`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="pk_test_…"
              className="font-mono"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-secret`}>API secret</FieldLabel>
            <Input
              id={`${ids}-secret`}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="sk_test_…"
              className="font-mono"
            />
            <FieldDescription>
              Stored encrypted in Vault; never shown again after saving.
            </FieldDescription>
          </Field>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={save}
            disabled={
              saving || key.trim().length === 0 || secret.trim().length === 0
            }
          >
            {saving ? "Saving…" : "Save credentials"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

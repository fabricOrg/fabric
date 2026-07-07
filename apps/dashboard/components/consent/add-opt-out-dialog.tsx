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
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  addOptOut,
  E164,
  type OptOut,
  type OptOutScope,
} from "@/lib/client/consent-api";
import { toastApiError } from "@/lib/error-toast";

/** Manual opt-out capture — for STOP requests received off-SMS (call, email, support). */
export function AddOptOutDialog({
  onAdd,
}: {
  onAdd: (optOut: OptOut) => void;
}) {
  const [open, setOpen] = useState(false);
  const [msisdn, setMsisdn] = useState("");
  const [scope, setScope] = useState<OptOutScope>("all");
  const [saving, setSaving] = useState(false);
  const msisdnId = useId();

  const touched = msisdn.length > 0;
  const valid = E164.test(msisdn.trim());

  function reset() {
    setMsisdn("");
    setScope("all");
  }

  async function submit() {
    if (!valid) return;
    setSaving(true);
    try {
      const created = await addOptOut({ msisdn: msisdn.trim(), scope });
      onAdd(created);
      toast.success("Opt-out added", {
        description: `${created.msisdn} excluded from ${
          created.scope === "all" ? "all" : "promotional"
        } sends.`,
      });
      setOpen(false);
      setTimeout(reset, 150);
    } catch (payload) {
      toastApiError(payload);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTimeout(reset, 150);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Add opt-out
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add manual opt-out</DialogTitle>
          <DialogDescription>
            Exclude a number from sends. Use this for opt-outs received off-SMS
            (calls, email, support).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <Field data-invalid={(touched && !valid) || undefined}>
            <FieldLabel htmlFor={msisdnId}>Number</FieldLabel>
            <Input
              id={msisdnId}
              inputMode="tel"
              placeholder="+2348031234567"
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value)}
              aria-invalid={(touched && !valid) || undefined}
              className="font-mono"
            />
            {touched && !valid && (
              <FieldError>
                Enter a valid E.164 number, e.g. +2348031234567.
              </FieldError>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="add-optout-scope">Scope</FieldLabel>
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as OptOutScope)}
            >
              <SelectTrigger id="add-optout-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All traffic</SelectItem>
                <SelectItem value="promotional">Promotional only</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} loading={saving} disabled={!valid}>
            Add opt-out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

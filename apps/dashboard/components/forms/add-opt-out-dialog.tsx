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
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  addOptOut,
  E164,
  type OptOut,
  type OptOutScope,
} from "@/lib/client/consent-api";
import { toastApiError } from "@/lib/error-toast";

const schema = z.object({
  msisdn: z
    .string()
    .refine(
      (v) => E164.test(v.trim()),
      "Enter a valid E.164 number, e.g. +2348031234567.",
    ),
  scope: z.enum(["all", "promotional"]),
});

/** Manual opt-out capture — for STOP requests received off-SMS (call, email, support). */
export function AddOptOutDialog({
  onAdd,
}: {
  onAdd: (optOut: OptOut) => void;
}) {
  const [open, setOpen] = useState(false);
  const msisdnId = useId();

  const form = useForm({
    defaultValues: { msisdn: "", scope: "all" as OptOutScope },
    validators: { onMount: schema, onChange: schema },
    onSubmit: async ({ value }) => {
      try {
        const created = await addOptOut({
          msisdn: value.msisdn.trim(),
          scope: value.scope,
        });
        onAdd(created);
        toast.success("Opt-out added", {
          description: `${created.msisdn} excluded from ${
            created.scope === "all" ? "all" : "promotional"
          } sends.`,
        });
        setOpen(false);
        setTimeout(() => form.reset(), 150);
      } catch (payload) {
        toastApiError(payload);
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTimeout(() => form.reset(), 150);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Add opt-out
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add manual opt-out</DialogTitle>
            <DialogDescription>
              Exclude a number from sends. Use this for opt-outs received
              off-SMS (calls, email, support).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <form.Field name="msisdn">
              {(field) => {
                const invalid = fieldInvalid(field);
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor={msisdnId}>Number</FieldLabel>
                    <Input
                      id={msisdnId}
                      inputMode="tel"
                      placeholder="+2348031234567"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      aria-invalid={invalid || undefined}
                      className="font-mono"
                    />
                    <FieldError field={field} />
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="scope">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="add-optout-scope">Scope</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as OptOutScope)}
                  >
                    <SelectTrigger id="add-optout-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All traffic</SelectItem>
                      <SelectItem value="promotional">
                        Promotional only
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <form.Subscribe
              selector={(s) => [s.canSubmit, s.isSubmitting] as const}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  loading={isSubmitting}
                  disabled={!canSubmit}
                >
                  Add opt-out
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

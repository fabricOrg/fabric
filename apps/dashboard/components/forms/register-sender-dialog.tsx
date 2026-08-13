"use client";

import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Textarea } from "@app/ui/components/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import {
  ALPHANUMERIC_MAX_LEN,
  type RegisterSenderInput,
  type SenderCountry,
  type SenderType,
} from "@/lib/client/senders-api";
import { schema } from "./register-sender-dialog.schema";

interface RegisterSenderDialogProps {
  /** Performs the registration (optimistic add + POST + toast live in the parent). Resolves on
   * success so the dialog can close; rejects so it stays open for a retry. */
  readonly onRegister: (input: RegisterSenderInput) => Promise<void>;
  readonly initialValues?: RegisterSenderInput;
  readonly triggerLabel?: string;
  readonly title?: string;
}

export function RegisterSenderDialog({
  onRegister,
  initialValues,
  triggerLabel = "Request sender ID",
  title = "Register a sender ID",
}: RegisterSenderDialogProps) {
  const [open, setOpen] = useState(false);
  const idBase = useId();
  const senderIdField = `${idBase}-sender-id`;
  const useCaseField = `${idBase}-use-case`;

  const form = useForm({
    defaultValues: {
      senderId: initialValues?.senderId ?? "",
      country: initialValues?.country ?? ("NG" as SenderCountry),
      type: initialValues?.type ?? ("alphanumeric" as SenderType),
      useCase: initialValues?.useCase ?? "",
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      try {
        await onRegister({
          senderId: value.senderId.trim(),
          country: value.country,
          type: value.type,
          useCase: value.useCase.trim(),
        });
        setOpen(false);
        form.reset();
      } catch {
        // Parent already surfaced the error via toastApiError; keep the dialog open for a retry.
      }
    },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) form.reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-6"
          noValidate
        >
          <DialogHeader>
            <DialogTitle className="font-display">{title}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* Type first — it governs the Sender ID field's format, placeholder + validation. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="type">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${idBase}-type`}>Type</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v as SenderType)}
                    >
                      <SelectTrigger id={`${idBase}-type`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alphanumeric">
                          Alphanumeric
                        </SelectItem>
                        <SelectItem value="short-code">Short code</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>

              <form.Field name="country">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${idBase}-country`}>
                      Country
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(v) =>
                        field.handleChange(v as SenderCountry)
                      }
                    >
                      <SelectTrigger id={`${idBase}-country`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NG">Nigeria</SelectItem>
                        <SelectItem value="GH">Ghana</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
            </div>

            <form.Subscribe selector={(s) => s.values.type}>
              {(type) => (
                <form.Field name="senderId">
                  {(field) => {
                    const invalid = fieldInvalid(field);
                    const overLimit =
                      type === "alphanumeric" &&
                      field.state.value.trim().length > ALPHANUMERIC_MAX_LEN;
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor={senderIdField}>
                          Sender ID
                        </FieldLabel>
                        <Input
                          id={senderIdField}
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          placeholder={
                            type === "short-code" ? "2929" : "Fabric"
                          }
                          autoComplete="off"
                          aria-invalid={invalid || undefined}
                          aria-describedby={`${senderIdField}-hint`}
                        />
                        {invalid ? (
                          <FieldError field={field} />
                        ) : (
                          <FieldDescription id={`${senderIdField}-hint`}>
                            {type === "alphanumeric" ? (
                              <span
                                className={
                                  overLimit ? "text-destructive" : undefined
                                }
                              >
                                {field.state.value.trim().length}/
                                {ALPHANUMERIC_MAX_LEN} characters · letters and
                                digits only.
                              </span>
                            ) : (
                              "3–8 digit numeric short code."
                            )}
                          </FieldDescription>
                        )}
                      </Field>
                    );
                  }}
                </form.Field>
              )}
            </form.Subscribe>

            <form.Field name="useCase">
              {(field) => {
                const invalid = fieldInvalid(field);
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor={useCaseField}>Use case</FieldLabel>
                    <Textarea
                      id={useCaseField}
                      rows={3}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="e.g. Transactional OTPs and delivery notifications."
                      aria-invalid={invalid || undefined}
                    />
                    {invalid ? <FieldError field={field} /> : null}
                  </Field>
                );
              }}
            </form.Field>
          </div>

          <DialogFooter showCloseButton>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Submitting…" : "Submit for review"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

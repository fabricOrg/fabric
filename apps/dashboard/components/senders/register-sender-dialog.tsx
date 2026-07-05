"use client";

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
  FieldError,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Textarea } from "@app/ui/components/ui/textarea";
import { Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import {
  ALPHANUMERIC_MAX_LEN,
  type RegisterSenderInput,
  type SenderCountry,
  type SenderType,
} from "@/lib/client/senders-api";

interface RegisterSenderDialogProps {
  /** Performs the registration (optimistic add + POST + toast live in the parent). Resolves on
   * success so the dialog can close; rejects so it stays open for a retry. */
  readonly onRegister: (input: RegisterSenderInput) => Promise<void>;
}

interface FieldErrors {
  senderId?: string;
  useCase?: string;
}

const USE_CASE_MIN_LEN = 10;

function validate(
  senderId: string,
  type: SenderType,
  useCase: string,
): FieldErrors {
  const errors: FieldErrors = {};
  const trimmedId = senderId.trim();

  if (!trimmedId) {
    errors.senderId = "Enter a sender ID.";
  } else if (type === "alphanumeric") {
    if (!/^[A-Za-z0-9]+$/.test(trimmedId)) {
      errors.senderId = "Use letters and digits only — no spaces or symbols.";
    } else if (trimmedId.length > ALPHANUMERIC_MAX_LEN) {
      errors.senderId = `Alphanumeric sender IDs are capped at ${ALPHANUMERIC_MAX_LEN} characters.`;
    }
  } else if (!/^\d{3,8}$/.test(trimmedId)) {
    errors.senderId = "Short codes must be 3–8 digits.";
  }

  if (useCase.trim().length < USE_CASE_MIN_LEN) {
    errors.useCase =
      "Describe how you'll use this sender ID (min 10 characters).";
  }

  return errors;
}

export function RegisterSenderDialog({
  onRegister,
}: RegisterSenderDialogProps) {
  const [open, setOpen] = useState(false);
  const [senderId, setSenderId] = useState("");
  const [country, setCountry] = useState<SenderCountry>("NG");
  const [type, setType] = useState<SenderType>("alphanumeric");
  const [useCase, setUseCase] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const idBase = useId();
  const senderIdField = `${idBase}-sender-id`;
  const useCaseField = `${idBase}-use-case`;

  function reset() {
    setSenderId("");
    setCountry("NG");
    setType("alphanumeric");
    setUseCase("");
    setErrors({});
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validate(senderId, type, useCase);
    setErrors(found);
    if (found.senderId || found.useCase) return;

    setSubmitting(true);
    try {
      await onRegister({
        senderId: senderId.trim(),
        country,
        type,
        useCase: useCase.trim(),
      });
      setOpen(false);
      reset();
    } catch {
      // Parent already surfaced the error via toastApiError; keep the dialog open for a retry.
    } finally {
      setSubmitting(false);
    }
  }

  const overLimit =
    type === "alphanumeric" && senderId.trim().length > ALPHANUMERIC_MAX_LEN;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Request sender ID
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-6"
          noValidate
        >
          <DialogHeader>
            <DialogTitle className="font-display">
              Register a sender ID
            </DialogTitle>
            <DialogDescription>
              Registration is reviewed by the carrier and, in Nigeria, the NCC.
              Approval typically takes 1–5 business days.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field data-invalid={errors.senderId ? true : undefined}>
              <FieldLabel htmlFor={senderIdField}>Sender ID</FieldLabel>
              <Input
                id={senderIdField}
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
                placeholder={type === "short-code" ? "2929" : "Fabric"}
                autoComplete="off"
                aria-invalid={errors.senderId ? true : undefined}
                aria-describedby={`${senderIdField}-hint`}
              />
              {errors.senderId ? (
                <FieldError>{errors.senderId}</FieldError>
              ) : (
                <FieldDescription id={`${senderIdField}-hint`}>
                  {type === "alphanumeric" ? (
                    <span
                      className={overLimit ? "text-destructive" : undefined}
                    >
                      {senderId.trim().length}/{ALPHANUMERIC_MAX_LEN} characters
                      · letters and digits only.
                    </span>
                  ) : (
                    "3–8 digit numeric short code."
                  )}
                </FieldDescription>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${idBase}-country`}>Country</FieldLabel>
                <Select
                  value={country}
                  onValueChange={(v) => setCountry(v as SenderCountry)}
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

              <Field>
                <FieldLabel htmlFor={`${idBase}-type`}>Type</FieldLabel>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as SenderType)}
                >
                  <SelectTrigger id={`${idBase}-type`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alphanumeric">Alphanumeric</SelectItem>
                    <SelectItem value="short-code">Short code</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field data-invalid={errors.useCase ? true : undefined}>
              <FieldLabel htmlFor={useCaseField}>Use case</FieldLabel>
              <Textarea
                id={useCaseField}
                rows={3}
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                placeholder="e.g. Transactional OTPs and delivery notifications."
                aria-invalid={errors.useCase ? true : undefined}
              />
              {errors.useCase ? (
                <FieldError>{errors.useCase}</FieldError>
              ) : (
                <FieldDescription>
                  Carriers approve sender IDs against a stated use case.
                </FieldDescription>
              )}
            </Field>
          </div>

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit for review"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

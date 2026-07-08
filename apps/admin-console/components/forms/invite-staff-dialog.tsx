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
import { useForm } from "@tanstack/react-form";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const schema = z.object({
  email: z.string().trim().regex(EMAIL, "Enter a valid email address."),
  role: z.enum(["operator", "admin"]),
});

interface ErrorPayload {
  error?: { message?: string };
}

export function InviteStaffDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: { email: "", role: "operator" as "operator" | "admin" },
    validators: { onMount: schema, onChange: schema },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      try {
        const response = await fetch("/api/admin/staff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, role: value.role }),
        });
        if (!response.ok) {
          const payload = (await response
            .json()
            .catch(() => null)) as ErrorPayload | null;
          throw new Error(
            payload?.error?.message ?? "Couldn't add the staff member.",
          );
        }
        toast.success(`${email} added as ${value.role}`, {
          description:
            "We've sent a WorkOS invite; they can also sign in via company SSO.",
        });
        setOpen(false);
        form.reset();
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't add the staff member.",
        );
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus data-icon="inline-start" />
          Add staff
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
            <DialogTitle>Add a staff member</DialogTitle>
            <DialogDescription>
              Allowlist a platform operator by email. They sign in with any
              WorkOS identity whose email matches.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <form.Field name="email">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="staff-email">Email address</FieldLabel>
                  <Input
                    id="staff-email"
                    type="email"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="operator@fabric.dev"
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="role">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="staff-role">Role</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) =>
                      field.handleChange(v as "operator" | "admin")
                    }
                  >
                    <SelectTrigger id="staff-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operator">Operator</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Admins can manage staff; operators have read access.
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
          </div>
          <DialogFooter>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
              )}
            </form.Subscribe>
            <form.Subscribe
              selector={(s) => [s.canSubmit, s.isSubmitting] as const}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  loading={isSubmitting}
                >
                  Add staff
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

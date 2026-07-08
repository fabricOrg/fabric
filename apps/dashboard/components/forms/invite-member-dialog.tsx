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
  email: z.string().regex(EMAIL, "Enter a valid email address."),
  role: z.enum(["admin", "member", "developer"]),
});

type InviteRole = "admin" | "member" | "developer";

interface BffErrorPayload {
  error?: { message?: string };
}

export function InviteMemberDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: { email: "", role: "member" as InviteRole },
    validators: { onMount: schema, onChange: schema },
    onSubmit: async ({ value }) => {
      try {
        const response = await fetch("/api/team/members", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: value.email.trim(), role: value.role }),
        });
        if (!response.ok) {
          const payload = (await response
            .json()
            .catch(() => null)) as BffErrorPayload | null;
          throw new Error(
            payload?.error?.message ?? "Couldn't send the invite.",
          );
        }
        toast.success(`Invite sent to ${value.email} as ${value.role}`, {
          description: "They'll get an email to join on Fabric.",
        });
        setOpen(false);
        form.reset();
        router.refresh(); // reflect the new invited member in the SSR list
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't send the invite.",
        );
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus data-icon="inline-start" />
          Invite member
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
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              They&apos;ll get an email to join your organisation on Fabric.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <form.Field name="email">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
                  <Input
                    id="invite-email"
                    type="email"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="teammate@company.com"
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="role">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as InviteRole)}
                  >
                    <SelectTrigger id="invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="developer">Developer</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Developers get the developer portal (API keys, logs) — no
                    SMS sending or team management.
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
                  Send invite
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

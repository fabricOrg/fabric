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
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface ErrorPayload {
  error?: { message?: string };
}

export function InviteStaffDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"operator" | "admin">("operator");
  const [pending, setPending] = useState(false);
  const valid = EMAIL.test(email);

  async function submit() {
    setPending(true);
    try {
      const response = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ErrorPayload | null;
        throw new Error(
          payload?.error?.message ?? "Couldn't add the staff member.",
        );
      }
      toast.success(`${email} added as ${role}`, {
        description: "They can sign in with a matching WorkOS identity.",
      });
      setOpen(false);
      setEmail("");
      setRole("operator");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't add the staff member.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus data-icon="inline-start" />
          Add staff
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a staff member</DialogTitle>
          <DialogDescription>
            Allowlist a platform operator by email. They sign in with any WorkOS
            identity whose email matches.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <Field>
            <FieldLabel htmlFor="staff-email">Email address</FieldLabel>
            <Input
              id="staff-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@fabric.dev"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="staff-role">Role</FieldLabel>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as "operator" | "admin")}
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
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button disabled={!valid} loading={pending} onClick={submit}>
            Add staff
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

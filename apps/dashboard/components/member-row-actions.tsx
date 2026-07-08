"use client";

import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@app/ui/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface ErrorPayload {
  error?: { message?: string };
}

type ManagedRole = "admin" | "member" | "developer";
const ROLE_LABEL: Record<ManagedRole, string> = {
  admin: "Admin",
  member: "Member",
  developer: "Developer",
};
const ROLES: ManagedRole[] = ["admin", "member", "developer"];

/**
 * Per-row member management (dashboard team page). Owner rows and the current user's own row render
 * no actions — the owner is immutable and self-management invites lockout confusion. Change role,
 * remove (soft, reversible), and resend a pending invite. The api enforces the same owner guard.
 */
export function MemberRowActions({
  userId,
  email,
  label,
  role,
  status,
}: {
  userId: string;
  email: string;
  label: string;
  role: ManagedRole;
  status: "active" | "invited" | "disabled";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function run(
    input: RequestInfo,
    init: RequestInit,
    success: string,
  ): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(input, init);
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ErrorPayload | null;
        throw new Error(payload?.error?.message ?? "Action failed.");
      }
      toast.success(success);
      setConfirmOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const changeRole = (next: ManagedRole) =>
    run(
      `/api/team/members/${userId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: next }),
      },
      `${label} is now a ${ROLE_LABEL[next].toLowerCase()}`,
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={busy}
            aria-label={`Manage ${label}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Change role</DropdownMenuLabel>
          {ROLES.filter((r) => r !== role).map((r) => (
            <DropdownMenuItem key={r} onClick={() => changeRole(r)}>
              Make {ROLE_LABEL[r].toLowerCase()}
            </DropdownMenuItem>
          ))}
          {status === "invited" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  run(
                    "/api/team/members",
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ email, role }),
                    },
                    `Invite re-sent to ${email}`,
                  )
                }
              >
                Resend invite
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setConfirmOpen(true)}
          >
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {label}?</DialogTitle>
            <DialogDescription>
              They lose access to this workspace immediately. You can re-invite
              them later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                run(
                  `/api/team/members/${userId}`,
                  { method: "DELETE" },
                  `Removed ${label}`,
                )
              }
              loading={busy}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

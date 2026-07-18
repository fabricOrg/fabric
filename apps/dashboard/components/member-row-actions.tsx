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

type ManagedRole = "admin" | "member";
type GovernanceRole = "owner" | ManagedRole;
const ROLE_LABEL: Record<GovernanceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};
const ROLES: ManagedRole[] = ["admin", "member"];
const ROLE_IMPACT: Record<ManagedRole, string> = {
  admin: "Gains messaging, compliance, billing, and team-management access.",
  member:
    "Keeps messaging and reporting access, but loses billing and team administration.",
};

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
  developerAccess,
  canChangeRole = true,
  status,
}: {
  userId: string;
  email: string;
  label: string;
  role: GovernanceRole;
  developerAccess: boolean;
  canChangeRole?: boolean;
  status: "active" | "invited" | "disabled";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingRole, setPendingRole] = useState<ManagedRole | null>(null);
  const [pendingDeveloperAccess, setPendingDeveloperAccess] = useState<
    boolean | null
  >(null);

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
          {canChangeRole ? (
            <>
              <DropdownMenuLabel>Change role</DropdownMenuLabel>
              {ROLES.filter((r) => r !== role).map((r) => (
                <DropdownMenuItem key={r} onClick={() => setPendingRole(r)}>
                  Make {ROLE_LABEL[r].toLowerCase()}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
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
                      body: JSON.stringify({
                        email,
                        role,
                        developer_access: developerAccess,
                      }),
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
            onClick={() => setPendingDeveloperAccess(!developerAccess)}
          >
            {developerAccess
              ? "Remove Developer access"
              : "Grant Developer access"}
          </DropdownMenuItem>
          {canChangeRole ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                Remove
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={pendingRole !== null}
        onOpenChange={(open) => !open && setPendingRole(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Change {label} to {pendingRole ? ROLE_LABEL[pendingRole] : ""}?
            </DialogTitle>
            <DialogDescription>
              {pendingRole ? ROLE_IMPACT[pendingRole] : null} Their permissions
              change immediately across Fabric after confirmation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingRole(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!pendingRole) return;
                await changeRole(pendingRole);
                setPendingRole(null);
              }}
              loading={busy}
            >
              Confirm role change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeveloperAccess !== null}
        onOpenChange={(open) => !open && setPendingDeveloperAccess(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDeveloperAccess ? "Grant" : "Remove"} Developer access for{" "}
              {label}?
            </DialogTitle>
            <DialogDescription>
              {pendingDeveloperAccess
                ? "They will be able to manage API keys, webhooks, and inspect request logs in addition to their current workspace role."
                : "They will lose API keys, webhooks, and request-log access, but retain their current workspace role."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDeveloperAccess(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (pendingDeveloperAccess === null) return;
                await run(
                  `/api/team/members/${userId}`,
                  {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      developer_access: pendingDeveloperAccess,
                    }),
                  },
                  `${pendingDeveloperAccess ? "Granted" : "Removed"} Developer access for ${label}`,
                );
                setPendingDeveloperAccess(null);
              }}
              loading={busy}
            >
              Confirm access change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

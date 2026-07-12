import type { MemberDto } from "@app/contracts";
import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
import { Badge } from "@app/ui/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { ErrorState, TableEmptyState } from "@app/ui/components/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { Check } from "lucide-react";
import { InviteMemberDialog } from "@/components/forms/invite-member-dialog";
import { MemberRowActions } from "@/components/member-row-actions";
import { BffError } from "@/lib/server/api-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { listMembers } from "@/lib/server/members-client";

type Role = MemberDto["role"];

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function initials(value: string): string {
  const source = value.trim();
  const parts = source.includes(" ") ? source.split(" ") : source.split("@");
  return parts
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant={role === "owner" ? "default" : "secondary"}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}

function StatusBadge({ status }: { status: MemberDto["status"] }) {
  const styles: Record<MemberDto["status"], string> = {
    active: "border-transparent bg-success/12 text-success",
    invited: "border-transparent bg-warning/15 text-warning",
    disabled: "border-transparent bg-muted text-muted-foreground",
  };
  const label: Record<MemberDto["status"], string> = {
    active: "Active",
    invited: "Invited",
    disabled: "Disabled",
  };
  return (
    <Badge variant="outline" className={styles[status]}>
      {label[status]}
    </Badge>
  );
}

export default async function TeamPage() {
  const session = await requireDashboardSession();
  const canInvite = session.role === "owner" || session.role === "admin";

  let members: MemberDto[] = [];
  let loadError = false;
  try {
    members = (await listMembers(session.orgId)).members;
  } catch (error) {
    // A configured-but-unreachable BFF shouldn't blank the page — show an inline notice instead.
    loadError = error instanceof BffError || error instanceof Error;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Team
        </h1>
        <p className="text-sm text-muted-foreground">
          Members and their roles in this organisation.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {canInvite
                ? "Owners and admins can invite and manage the team."
                : "Owners and admins manage the team."}
            </CardDescription>
            {canInvite ? (
              <CardAction>
                <InviteMemberDialog />
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            {loadError ? (
              <ErrorState
                title="Couldn't load team members"
                message="The member directory is temporarily unavailable. Refresh the page to try again."
              />
            ) : members.length === 0 ? (
              <TableEmptyState
                title="No team members yet"
                description="Invite a teammate and assign the minimum role they need."
                action={canInvite ? <InviteMemberDialog /> : undefined}
              />
            ) : (
              <section
                className="overflow-x-auto"
                tabIndex={0}
                aria-label="Team members"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                      {canInvite ? (
                        <TableHead className="w-10 text-right">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={m.user_id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="size-8">
                              <AvatarFallback>
                                {initials(m.name ?? m.email)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {m.name ?? m.email}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {m.email}
                              </span>
                              {m.status === "invited" ? (
                                <span className="text-xs text-muted-foreground">
                                  Invited{" "}
                                  {new Date(m.updated_at).toLocaleDateString(
                                    "en",
                                    {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    },
                                  )}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <RoleBadge role={m.role} />
                            {m.developer_access ? (
                              <Badge variant="outline">Developer access</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <StatusBadge status={m.status} />
                        </TableCell>
                        {canInvite ? (
                          <TableCell className="text-right">
                            <MemberRowActions
                              userId={m.user_id}
                              email={m.email}
                              label={m.name ?? m.email}
                              role={m.role}
                              developerAccess={m.developer_access}
                              status={m.status}
                              canChangeRole={
                                m.role !== "owner" &&
                                m.user_id !== session.userId
                              }
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Your access</CardTitle>
            <CardDescription>
              Your current role controls what you can view and change.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {ROLE_LABEL[session.role as Role] ?? session.role}
                </span>
                <span className="text-xs text-muted-foreground">
                  {session.role === "owner"
                    ? "Full workspace, billing, and team control"
                    : session.role === "admin"
                      ? "Operational and team management access"
                      : "Messaging and reporting access"}
                </span>
              </div>
              <Badge variant="secondary" className="gap-1">
                <Check />
                Current
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import type { StaffDto } from "@app/contracts";
import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
import { Badge } from "@app/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { InviteStaffDialog } from "@/components/invite-staff-dialog";
import { StaffRowActions } from "@/components/staff-row-actions";
import { requireAdminSession } from "@/lib/server/auth";
import { listStaff, StaffApiError } from "@/lib/server/staff-client";

type StaffRole = StaffDto["role"];

const ROLE_LABEL: Record<StaffRole, string> = {
  operator: "Operator",
  admin: "Admin",
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

function StatusBadge({ status }: { status: StaffDto["status"] }) {
  return status === "suspended" ? (
    <Badge
      variant="outline"
      className="border-transparent bg-warning/15 text-warning"
    >
      Suspended
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="border-transparent bg-success/12 text-success"
    >
      Active
    </Badge>
  );
}

export default async function StaffPage() {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");
  const selfId = session.userId;

  let staff: StaffDto[] = [];
  let loadError = false;
  try {
    staff = (await listStaff()).staff;
  } catch (error) {
    loadError = error instanceof StaffApiError || error instanceof Error;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Staff
          </h1>
          <p className="text-sm text-muted-foreground">
            Platform operators. Access is by email allowlist — they sign in with
            a matching WorkOS identity.
          </p>
        </div>
        {canManage ? <InviteStaffDialog /> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All staff</CardTitle>
          <CardDescription>
            {canManage
              ? "Admins add operators and other admins, and can suspend or remove access."
              : "Only staff admins can add or change staff."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Couldn&apos;t load staff right now. Try again shortly.
            </p>
          ) : staff.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No staff yet.
            </p>
          ) : (
            <section
              className="overflow-x-auto"
              tabIndex={0}
              aria-label="Staff members"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Access</TableHead>
                    {canManage ? (
                      <TableHead className="text-right">Actions</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((s) => (
                    <TableRow key={s.staff_user_id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarFallback>
                              {initials(s.name ?? s.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {s.name ?? s.email}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {s.email}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={s.role === "admin" ? "default" : "secondary"}
                        >
                          {ROLE_LABEL[s.role]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            s.bound
                              ? "text-xs text-muted-foreground"
                              : "text-xs text-warning"
                          }
                        >
                          {s.bound ? "Signed in" : "Pending"}
                        </span>
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          {s.staff_user_id === selfId ? (
                            <span className="text-xs text-muted-foreground">
                              You
                            </span>
                          ) : (
                            <StaffRowActions
                              id={s.staff_user_id}
                              label={s.name ?? s.email}
                              role={s.role}
                              status={s.status}
                            />
                          )}
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
    </div>
  );
}

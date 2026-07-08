import type { StaffDto } from "@app/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { InviteStaffDialog } from "@/components/forms/invite-staff-dialog";
import { StaffTable } from "@/components/tables/staff-table";
import { requireAdminSession } from "@/lib/server/auth";
import { listStaff, StaffApiError } from "@/lib/server/staff-client";

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
          ) : (
            <StaffTable staff={staff} canManage={canManage} selfId={selfId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

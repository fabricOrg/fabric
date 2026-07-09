import type { AuditEventDto } from "@app/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { AuditTable } from "@/components/tables/audit-table";
import { AuditApiError, listAudit } from "@/lib/server/audit-client";
import { requireAdminSession } from "@/lib/server/auth";

export default async function AuditPage() {
  await requireAdminSession();

  let events: AuditEventDto[] = [];
  let nextCursor: string | null = null;
  let loadError = false;
  try {
    const page = await listAudit();
    events = page.events;
    nextCursor = page.next_cursor;
  } catch (error) {
    loadError = error instanceof AuditApiError || error instanceof Error;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Audit log
        </h1>
        <p className="text-sm text-muted-foreground">
          Immutable record of every staff action — actor, action, and reason.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Append-only; entries are never edited or deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Couldn&apos;t load the audit log right now. Try again shortly.
            </p>
          ) : (
            <AuditTable events={events} nextCursor={nextCursor} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

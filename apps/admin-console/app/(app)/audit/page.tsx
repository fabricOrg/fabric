import type { AuditEventDto } from "@app/contracts";
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
import { AuditApiError, listAudit } from "@/lib/server/audit-client";
import { requireAdminSession } from "@/lib/server/auth";

function formatTime(iso: string): string {
  // Stable UTC render (avoids SSR/client locale drift): "2026-07-07 02:31".
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function target(event: AuditEventDto): string {
  if (!event.target_type) return "—";
  return event.target_id
    ? `${event.target_type}:${event.target_id}`
    : event.target_type;
}

export default async function AuditPage() {
  await requireAdminSession();

  let events: AuditEventDto[] = [];
  let loadError = false;
  try {
    events = (await listAudit()).events;
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
          ) : events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No activity recorded yet.
            </p>
          ) : (
            <section
              className="overflow-x-auto"
              tabIndex={0}
              aria-label="Audit log"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-sm">
                        {e.actor_email ?? "system"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="font-mono text-xs"
                        >
                          {e.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {target(e)}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm">
                        {e.summary}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {e.reason ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                        {formatTime(e.created_at)}
                      </TableCell>
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

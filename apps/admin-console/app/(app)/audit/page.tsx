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
import { ArrowRight } from "lucide-react";
import { AUDIT } from "@/lib/mock-admin";

export default function AuditPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Audit log
        </h1>
        <p className="text-sm text-muted-foreground">
          Immutable record of every staff action — actor, change, and reason.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Append-only; entries are never edited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Semantic <section> keeps the wide table's scroll region keyboard-focusable (WCAG 2.1.1). */}
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
                  <TableHead>Change</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {AUDIT.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-sm">
                      {e.actor}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {e.action}
                      </Badge>
                    </TableCell>
                    <TableCell>{e.target}</TableCell>
                    <TableCell>
                      {e.before !== undefined && e.after !== undefined ? (
                        <span className="flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground line-through">
                            {e.before}
                          </span>
                          <ArrowRight className="size-3 text-muted-foreground" />
                          <span className="font-medium">{e.after}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs text-sm text-muted-foreground">
                      {e.reason}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                      {e.at}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

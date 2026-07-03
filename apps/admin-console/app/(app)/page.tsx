import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Input } from "@app/ui/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { TENANTS, type Tenant, type TenantStatus } from "@/lib/mock-admin";
import { formatMoney } from "@/lib/money";

const STATUS: Record<TenantStatus, string> = {
  active: "border-transparent bg-success/12 text-success",
  suspended: "border-transparent bg-warning/15 text-warning",
  closed: "border-transparent bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: TenantStatus }) {
  return (
    <Badge variant="outline" className={STATUS[status]}>
      {status[0]?.toUpperCase()}
      {status.slice(1)}
    </Badge>
  );
}

export default function TenantsPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Tenants
        </h1>
        <p className="text-sm text-muted-foreground">
          Every customer organisation on Fabric. Accounts soft-close — never
          hard-delete.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All tenants</CardTitle>
          <CardDescription>Search, review health, and manage.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Input
            placeholder="Search tenants…"
            className="sm:max-w-xs"
            aria-label="Search tenants"
          />
          {/* Semantic <section> keeps the wide table's scroll region keyboard-focusable (WCAG 2.1.1). */}
          <section
            className="overflow-x-auto"
            tabIndex={0}
            aria-label="Tenants"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TENANTS.map((t: Tenant) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{t.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {t.slug}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {t.plan}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(t.balance)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.region}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
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

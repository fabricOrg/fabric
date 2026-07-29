import type {
  MemberDto,
  PriceBookDto,
  SandboxAllowancePolicy,
} from "@app/contracts";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { notFound } from "next/navigation";
import { AccountPriceBookAssign } from "@/components/account-price-book-assign";
import { SetBreadcrumbTitle } from "@/components/breadcrumb-title";
import { InviteTenantMemberDialog } from "@/components/forms/invite-tenant-member-dialog";
import { SandboxAllowancePolicyEditor } from "@/components/sandbox-allowance-policy";
import { TenantMemberRowActions } from "@/components/tenant-member-row-actions";
import { TenantStatusActions } from "@/components/tenant-status-actions";
import { requireAdminSession } from "@/lib/server/auth";
import { listPriceBooks } from "@/lib/server/price-book-client";
import {
  listTenantMembers,
  TenantMemberApiError,
} from "@/lib/server/tenant-members-client";
import {
  getSandboxAllowancePolicy,
  listTenants,
} from "@/lib/server/tenants-client";

type Role = MemberDto["role"];
const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};
const STATUS_STYLE: Record<MemberDto["status"], string> = {
  active: "border-transparent bg-success/12 text-success",
  invited: "border-transparent bg-warning/15 text-warning",
  disabled: "border-transparent bg-muted text-muted-foreground",
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

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");
  const { slug } = await params;

  // The staff tenant list is small; resolve the tenant from it by SLUG (the human-readable URL
  // key) rather than adding a get-one endpoint. Member ops below still key off tenant.tenant_id
  // (the UUID the /internal endpoints expect).
  const tenant = (await listTenants()).tenants.find((t) => t.slug === slug);
  if (!tenant) notFound();

  let members: MemberDto[] = [];
  let loadError = false;
  try {
    members = (await listTenantMembers(tenant.tenant_id)).members;
  } catch (error) {
    loadError = error instanceof TenantMemberApiError || error instanceof Error;
  }

  // Price books drive the assignment control below; a failure just hides the picker (non-critical).
  let books: PriceBookDto[] = [];
  try {
    books = (await listPriceBooks()).books;
  } catch {
    books = [];
  }
  const assignedBook =
    books.find((b) => b.id === tenant.price_book_id)?.name ??
    "Default (by mode)";
  let sandboxPolicy: SandboxAllowancePolicy | null = null;
  try {
    sandboxPolicy = await getSandboxAllowancePolicy(tenant.tenant_id);
  } catch {
    sandboxPolicy = null;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {/* The breadcrumb (Admin › <tenant>) is the way back to the list, so no separate back button. */}
      <SetBreadcrumbTitle title={tenant.name} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {tenant.name}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">
            {tenant.slug} · {tenant.plan} · {tenant.data_region}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="capitalize">
            {tenant.status}
          </Badge>
          {canManage ? (
            <TenantStatusActions
              tenantId={tenant.tenant_id}
              name={tenant.name}
              status={tenant.status}
            />
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
          <CardDescription>
            The rate plan this tenant is billed against. Default resolves by
            mode. Changes are audited.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">
            Current: <span className="font-medium">{assignedBook}</span>
          </span>
          {canManage && books.length > 0 ? (
            <AccountPriceBookAssign
              accountId={tenant.tenant_id}
              currentBookId={tenant.price_book_id}
              currentBillingCurrency={tenant.billing_currency}
              books={books}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sandbox allowances</CardTitle>
          <CardDescription>
            Workspace-wide daily capacity. SMS counts segments and email counts
            messages. Changes apply when the next UTC bucket is created; a
            bucket already used today keeps its original limit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!sandboxPolicy ? (
            <p className="text-sm text-muted-foreground">
              Sandbox allowance settings are temporarily unavailable.
            </p>
          ) : canManage ? (
            <SandboxAllowancePolicyEditor
              tenantId={tenant.tenant_id}
              initial={sandboxPolicy}
            />
          ) : (
            <p className="text-sm">
              {sandboxPolicy.sms_segments_per_day} SMS segments and{" "}
              {sandboxPolicy.email_messages_per_day} email messages per UTC day.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {tenant.workos_organization_id
              ? "People with access to this organisation."
              : "This tenant has no WorkOS org yet — invites are unavailable."}
          </CardDescription>
          {canManage && tenant.workos_organization_id ? (
            <CardAction>
              <InviteTenantMemberDialog tenantId={tenant.tenant_id} />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Couldn&apos;t load members right now. Try again shortly.
            </p>
          ) : members.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No members yet.
            </p>
          ) : (
            <section
              className="overflow-x-auto"
              tabIndex={0}
              aria-label={`${tenant.name} members`}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                    {canManage ? (
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
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="secondary">
                            {ROLE_LABEL[m.role]}
                          </Badge>
                          {m.developer_access ? (
                            <Badge variant="outline">Developer access</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={`capitalize ${STATUS_STYLE[m.status]}`}
                        >
                          {m.status}
                        </Badge>
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          {m.role !== "owner" ? (
                            <TenantMemberRowActions
                              tenantId={tenant.tenant_id}
                              userId={m.user_id}
                              email={m.email}
                              label={m.name ?? m.email}
                              role={m.role}
                              developerAccess={m.developer_access}
                              status={m.status}
                            />
                          ) : null}
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

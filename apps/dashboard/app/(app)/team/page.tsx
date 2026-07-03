import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
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
import { Check } from "lucide-react";
import { InviteMemberDialog } from "@/components/invite-member-dialog";

type Role = "owner" | "admin" | "member";

interface Member {
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited";
}

// Mock — TODO(BFF): from the tenant's memberships (WorkOS org). Roles mirror @app/db membershipRole.
const MEMBERS: readonly Member[] = [
  {
    name: "Ama Owusu",
    email: "ama@kwikgh.com",
    role: "owner",
    status: "active",
  },
  {
    name: "Kofi Mensah",
    email: "kofi@kwikgh.com",
    role: "admin",
    status: "active",
  },
  {
    name: "Efua Boateng",
    email: "efua@kwikgh.com",
    role: "member",
    status: "invited",
  },
];

const ORGS: readonly { name: string; role: Role; current: boolean }[] = [
  { name: "KwikGH", role: "owner", current: true },
  { name: "Accra Media", role: "member", current: false },
];

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function initials(name: string): string {
  return name
    .split(" ")
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

export default function TeamPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Team
        </h1>
        <p className="text-sm text-muted-foreground">
          Members, roles, and the organisations you belong to.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Owners and admins can invite and manage the team.
            </CardDescription>
            <CardAction>
              <InviteMemberDialog />
            </CardAction>
          </CardHeader>
          <CardContent>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MEMBERS.map((m) => (
                    <TableRow key={m.email}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarFallback>{initials(m.name)}</AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <span className="font-medium">{m.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {m.email}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={m.role} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={
                            m.status === "active"
                              ? "border-transparent bg-success/12 text-success"
                              : "border-transparent bg-warning/15 text-warning"
                          }
                        >
                          {m.status === "active" ? "Active" : "Invited"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Organisations</CardTitle>
            <CardDescription>
              Switch the org you&apos;re working in.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {ORGS.map((o) => (
              <div
                key={o.name}
                className="flex items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{o.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABEL[o.role]}
                  </span>
                </div>
                {o.current ? (
                  <Badge variant="secondary" className="gap-1">
                    <Check />
                    Current
                  </Badge>
                ) : (
                  <Button variant="outline" size="sm">
                    Switch
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

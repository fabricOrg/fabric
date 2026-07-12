import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
import { Badge } from "@app/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { KeyRound, Mail, ShieldCheck } from "lucide-react";

export function ProfileView({
  email,
  name,
  role,
}: {
  email?: string;
  name?: string;
  role: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-4">
        <Avatar size="lg">
          <AvatarFallback>
            {(name ?? email)?.charAt(0).toUpperCase() ?? "F"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <CardTitle className="truncate">
            {name ?? email ?? "Fabric user"}
          </CardTitle>
          {name && email ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {email}
            </p>
          ) : null}
          <Badge variant="secondary" className="mt-2 capitalize">
            {role}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 border-t pt-6 sm:grid-cols-2">
        <ProfileField
          icon={<Mail />}
          label="Email"
          value={email ?? "Not available"}
        />
        <ProfileField
          icon={<ShieldCheck />}
          label="Role"
          value={role}
          capitalize
        />
        <ProfileField
          icon={<KeyRound />}
          label="Authentication"
          value="Managed securely by WorkOS"
        />
      </CardContent>
    </Card>
  );
}

function ProfileField({
  icon,
  label,
  value,
  capitalize,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <p className={`text-sm ${capitalize ? "capitalize" : ""} break-words`}>
        {value}
      </p>
    </div>
  );
}

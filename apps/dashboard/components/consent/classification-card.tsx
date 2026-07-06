import { Badge } from "@app/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { cn } from "@app/ui/lib/utils";
import {
  CheckCheck,
  type LucideIcon,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import type { ClassificationRule } from "@/lib/client/consent-api";

/**
 * Teaches the core rule at a glance: promotional traffic is DND-filtered + time-boxed, transactional
 * traffic bypasses both. Colour is never the only signal (WCAG) — each control pairs a token with a
 * word ("Enforced" / "Bypassed").
 */

const CATEGORY_META: Record<
  ClassificationRule["category"],
  { label: string; icon: LucideIcon; iconCls: string }
> = {
  promotional: {
    label: "Promotional",
    icon: Megaphone,
    iconCls: "bg-warning/15 text-warning-strong",
  },
  transactional: {
    label: "Transactional",
    icon: ShieldCheck,
    iconCls: "bg-success/12 text-success",
  },
};

/** Yes = a control applies (restricted); No = the control is bypassed (delivers anytime). */
function ControlBadge({
  active,
  onLabel,
  offLabel,
}: {
  active: boolean;
  onLabel: string;
  offLabel: string;
}) {
  return active ? (
    <Badge
      variant="outline"
      className="gap-1 border-transparent bg-warning/15 text-warning-strong"
    >
      {onLabel}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="gap-1 border-transparent bg-success/12 text-success"
    >
      <CheckCheck />
      {offLabel}
    </Badge>
  );
}

function RuleRow({ rule }: { rule: ClassificationRule }) {
  const meta = CATEGORY_META[rule.category];
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
            meta.iconCls,
          )}
        >
          <Icon />
        </span>
        <div className="flex flex-col">
          <span className="font-medium">{meta.label}</span>
          <span className="text-xs text-muted-foreground">
            {rule.category === "transactional"
              ? "OTP · alerts · receipts"
              : "Marketing · campaigns"}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{rule.description}</p>

      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <div className="flex items-center gap-2">
          <dt className="text-xs font-medium text-muted-foreground">
            DND filter
          </dt>
          <dd>
            <ControlBadge
              active={rule.dndFiltered}
              onLabel="Filtered"
              offLabel="Bypassed"
            />
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-xs font-medium text-muted-foreground">
            Quiet hours
          </dt>
          <dd>
            <ControlBadge
              active={rule.quietHoursEnforced}
              onLabel="Enforced"
              offLabel="Exempt"
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function ClassificationCard({
  rules,
}: {
  rules: readonly ClassificationRule[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Traffic classification</CardTitle>
        <CardDescription>
          How each message category is treated against DND and quiet hours.
          Classification is automatic — OTP and alerts always reach the handset.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {rules.map((rule) => (
          <RuleRow key={rule.category} rule={rule} />
        ))}
      </CardContent>
    </Card>
  );
}

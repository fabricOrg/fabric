import {
  Blocks,
  Building2,
  GitPullRequestArrow,
  type LucideIcon,
  Package,
  Power,
  Radio,
  ScrollText,
  ShieldOff,
  Tags,
  UserCog,
  Users,
} from "lucide-react";

/** Fabric Admin (staff) information architecture — control-plane operations, grouped by concern. */
export interface NavItem {
  readonly title: string;
  readonly href: string;
  readonly icon: LucideIcon;
}
export interface NavGroup {
  readonly label?: string;
  readonly items: readonly NavItem[];
}

export const navGroups: readonly NavGroup[] = [
  { items: [{ title: "Tenants", href: "/", icon: Building2 }] },
  {
    label: "Operations",
    items: [
      {
        title: "Maker-checker",
        href: "/maker-checker",
        icon: GitPullRequestArrow,
      },
      { title: "Senders", href: "/senders", icon: Radio },
      { title: "Pricing", href: "/pricing", icon: Tags },
      { title: "Prepaid offers", href: "/pricing/offers", icon: Package },
      { title: "Impersonation", href: "/impersonation", icon: UserCog },
      { title: "Kill-switch", href: "/kill-switch", icon: Power },
      { title: "Data requests", href: "/privacy", icon: ShieldOff },
    ],
  },
  {
    label: "Access",
    items: [{ title: "Staff", href: "/staff", icon: Users }],
  },
  {
    label: "Integrations",
    items: [{ title: "Plugins", href: "/plugins", icon: Blocks }],
  },
  {
    label: "Trust",
    items: [{ title: "Audit log", href: "/audit", icon: ScrollText }],
  },
];

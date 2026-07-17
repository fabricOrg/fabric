import {
  BadgeCheck,
  BellOff,
  Boxes,
  LayoutDashboard,
  Library,
  List,
  type LucideIcon,
  Mail,
  Megaphone,
  PackageCheck,
  Send,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";

/**
 * Dashboard information architecture. THE key correction vs the imported design: the app is the
 * tenant CONSOLE, not "the SMS product". Channel/campaign screens live under Messaging; Verify is a
 * product-neutral primitive; sender-ID + consent are Compliance (Nigeria NCC gates delivery on them);
 * the wallet is a product-NEUTRAL account concern (every product bills from it) so it sits in Account.
 * Overview keeps balance VISIBILITY up top. Groups here also feed the ⌘K command palette.
 */
export interface NavItem {
  readonly title: string;
  readonly href: string;
  readonly icon: LucideIcon;
  /** Mock-first surface with no real backend yet — badged "Preview" in deployed builds (honesty). */
  readonly preview?: boolean;
}

export interface NavGroup {
  readonly label?: string;
  readonly items: readonly NavItem[];
}

export const navGroups: readonly NavGroup[] = [
  {
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboard },
      { title: "API transactions", href: "/flows", icon: Workflow },
    ],
  },
  {
    label: "Developers",
    items: [
      // ADR-0004: applications are the workspace's top-level structure; each carries a sandbox and a
      // live environment, and OWNS its API keys (+ webhooks/logs under W-B). Those live on the
      // application-detail page (/applications/[slug]), not a flat top-level list.
      { title: "Applications", href: "/applications", icon: Boxes },
    ],
  },
  {
    label: "Messaging",
    items: [
      { title: "Send SMS", href: "/send", icon: Send },
      { title: "SMS Templates", href: "/templates", icon: Library },
      { title: "Virtual phone", href: "/virtual-phone", icon: Smartphone },
      {
        title: "Campaigns",
        href: "/campaigns",
        icon: Megaphone,
        preview: true,
      },
      { title: "Messages", href: "/messages", icon: List },
      {
        title: "Managed deliveries",
        href: "/message-deliveries",
        icon: PackageCheck,
      },
      { title: "Emails", href: "/emails", icon: Mail },
      {
        title: "Number verification",
        href: "/verify",
        icon: ShieldCheck,
      },
    ],
  },
  {
    label: "Compliance",
    items: [
      {
        title: "Sender IDs",
        href: "/senders",
        icon: BadgeCheck,
      },
      {
        title: "Consent & DND",
        href: "/consent",
        icon: BellOff,
      },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "Billing & Wallet", href: "/wallet", icon: Wallet },
      { title: "Team", href: "/team", icon: Users },
    ],
  },
];

/** Flattened destinations for the ⌘K command palette (single source of truth = navGroups). */
export const navCommands: readonly {
  title: string;
  href: string;
  group: string;
  icon: LucideIcon;
}[] = navGroups.flatMap((g) =>
  g.items.map((item) => ({
    title: item.title,
    href: item.href,
    group: g.label ?? "General",
    icon: item.icon,
  })),
);

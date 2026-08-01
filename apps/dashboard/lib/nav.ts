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
  /** Permission scope the page needs. Absent → always visible (Overview). A member lacking it never
   *  sees the item in the sidebar (or command palette). */
  readonly permission?: string;
  /** Membership roles allowed to see this item (for role-gated pages like Team, which isn't a
   *  permission scope). Absent → any role. */
  readonly roles?: readonly string[];
  /** Sandbox funding is a daily allowance, never a wallet or paid token purchase. */
  readonly hideInSandbox?: boolean;
}

/** True when a session (its permissions + membership role) may see a nav item. */
export function canSeeNavItem(
  item: NavItem,
  ctx: {
    readonly permissions: readonly string[];
    readonly role: string;
    readonly plan?: string;
  },
): boolean {
  if (item.permission && !ctx.permissions.includes(item.permission)) {
    return false;
  }
  if (item.roles && !item.roles.includes(ctx.role)) return false;
  if (item.hideInSandbox && ctx.plan === "sandbox") return false;
  return true;
}

export interface NavGroup {
  readonly label?: string;
  readonly items: readonly NavItem[];
}

export const navGroups: readonly NavGroup[] = [
  {
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboard },
      {
        title: "API transactions",
        href: "/flows",
        icon: Workflow,
        permission: "request_logs:read",
      },
    ],
  },
  {
    label: "Developers",
    items: [
      // ADR-0004: applications are the workspace's top-level structure; each carries a sandbox and a
      // live environment, and OWNS its API keys (+ webhooks/logs under W-B). Those live on the
      // application-detail page (/applications/[slug]), not a flat top-level list.
      {
        title: "Applications",
        href: "/applications",
        icon: Boxes,
        permission: "api_keys:read",
      },
    ],
  },
  {
    label: "Messaging",
    items: [
      { title: "Send SMS", href: "/send", icon: Send, permission: "sms:send" },
      {
        title: "SMS Templates",
        href: "/templates",
        icon: Library,
        permission: "sms:send",
      },
      {
        title: "Virtual phone",
        href: "/virtual-phone",
        icon: Smartphone,
        permission: "sms:read",
      },
      {
        title: "Campaigns",
        href: "/campaigns",
        icon: Megaphone,
        preview: true,
        permission: "sms:send",
      },
      {
        title: "Messages",
        href: "/messages",
        icon: List,
        permission: "sms:read",
      },
      {
        title: "Managed deliveries",
        href: "/message-deliveries",
        icon: PackageCheck,
        permission: "messages:read",
      },
      {
        title: "Emails",
        href: "/emails",
        icon: Mail,
        permission: "email:read",
      },
      {
        title: "Number verification",
        href: "/verify",
        icon: ShieldCheck,
        permission: "sms:send",
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
        permission: "sms:send",
      },
      {
        title: "Consent & DND",
        href: "/consent",
        icon: BellOff,
        permission: "sms:send",
      },
    ],
  },
  {
    label: "Account",
    items: [
      {
        title: "Billing & Tokens",
        href: "/wallet",
        icon: Wallet,
        permission: "wallet:read",
        hideInSandbox: true,
      },
      // Team management is role-gated (owner/admin), not a permission scope.
      { title: "Team", href: "/team", icon: Users, roles: ["owner", "admin"] },
    ],
  },
];

/** Flattened destinations for the ⌘K command palette (single source of truth = navGroups). Carries
 *  each item's permission/roles so the palette can hide what the sidebar hides (canSeeNavCommand). */
export interface NavCommand {
  title: string;
  href: string;
  group: string;
  icon: LucideIcon;
  permission?: string;
  roles?: readonly string[];
  hideInSandbox?: boolean;
}

export const navCommands: readonly NavCommand[] = navGroups.flatMap((g) =>
  g.items.map((item) => ({
    title: item.title,
    href: item.href,
    group: g.label ?? "General",
    icon: item.icon,
    ...(item.permission ? { permission: item.permission } : {}),
    ...(item.roles ? { roles: item.roles } : {}),
    ...(item.hideInSandbox ? { hideInSandbox: true } : {}),
  })),
);

/** Palette-side visibility check — mirrors canSeeNavItem for a flattened command. */
export function canSeeNavCommand(
  cmd: NavCommand,
  ctx: {
    readonly permissions: readonly string[];
    readonly role: string;
    readonly plan?: string;
  },
): boolean {
  if (cmd.permission && !ctx.permissions.includes(cmd.permission)) return false;
  if (cmd.roles && !cmd.roles.includes(ctx.role)) return false;
  if (cmd.hideInSandbox && ctx.plan === "sandbox") return false;
  return true;
}

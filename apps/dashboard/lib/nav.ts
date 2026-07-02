import {
  LayoutDashboard,
  List,
  type LucideIcon,
  Send,
  Users,
  Wallet,
} from "lucide-react";

/**
 * Dashboard information architecture. THE key correction vs the imported design: the app is the
 * tenant CONSOLE, not "the SMS product". SMS-specific screens live under a Messaging group; the
 * wallet is a product-NEUTRAL account concern (SMS, and soon Verify, both bill from it), so it sits
 * in its own Account group — not nested under Messaging. Overview keeps balance VISIBILITY up top.
 */
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
  { items: [{ title: "Overview", href: "/", icon: LayoutDashboard }] },
  {
    label: "Messaging",
    items: [
      { title: "Send SMS", href: "/send", icon: Send },
      { title: "Messages", href: "/messages", icon: List },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "Wallet & Billing", href: "/wallet", icon: Wallet },
      { title: "Team", href: "/team", icon: Users },
    ],
  },
];

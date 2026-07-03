import {
  BookText,
  KeyRound,
  type LucideIcon,
  ScrollText,
  Webhook,
} from "lucide-react";

/**
 * Dev-portal IA (customer realm, developers.*). Where a developer integrates Fabric: credentials,
 * reference, webhooks, and request logs. Distinct app from the dashboard, same customer WorkOS realm
 * (auth mocked until PI-3). API keys is the landing surface — time-to-first-key is the funnel.
 */
export interface NavItem {
  readonly title: string;
  readonly href: string;
  readonly icon: LucideIcon;
}

export const navItems: readonly NavItem[] = [
  { title: "API keys", href: "/", icon: KeyRound },
  { title: "API reference", href: "/reference", icon: BookText },
  { title: "Webhooks", href: "/webhooks", icon: Webhook },
  { title: "Logs", href: "/logs", icon: ScrollText },
];

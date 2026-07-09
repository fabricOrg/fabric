import { z } from "zod";

export const REGIONS = [
  { value: "gh-accra", label: "Ghana · Accra" },
  { value: "ng-lagos", label: "Nigeria · Lagos" },
  { value: "ke-nairobi", label: "Kenya · Nairobi" },
] as const;

export const PLANS = ["free", "growth", "scale"] as const;
export type Plan = (typeof PLANS)[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Derive a URL/API-safe slug from the business name (used until the user edits the slug field). */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/**
 * Same rules the button used to gate on: name ≥ 2 chars, a lower-case slug (letters/digits/dashes,
 * ≥ 2 chars), a valid admin email. Region is a free string (validated by the select's options) and
 * plan is one of the three tiers.
 */
export const schema = z.object({
  name: z.string().trim().min(2, "Enter a business name."),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{2,}$/, "Lower-case letters, numbers and dashes only."),
  region: z.string().min(1),
  plan: z.enum(["free", "growth", "scale"]),
  adminEmail: z.string().trim().regex(EMAIL, "Enter a valid email address."),
});

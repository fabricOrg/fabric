import type { Creds } from "@app/integrations";
import { z } from "zod";
import { invalidRequest } from "../http/api-error.js";

/**
 * Helpers for reading the WhatsApp template cache. Split out of `whatsapp-template.service.ts` to keep
 * that file under the length guard; grouped here because they all answer the same question — how much
 * do we trust our local copy of Meta-owned state.
 */

/** How long a synced row is trusted. Past this the cache is treated as unknown, not as authority. */
export const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const wabaCredentialSchema = z.object({ waba_id: z.string().trim().min(1) });

export function parseWabaId(creds: Creds): string {
  const parsed = wabaCredentialSchema.safeParse(creds);
  if (parsed.success) return parsed.data.waba_id;
  throw invalidRequest(
    "live_whatsapp_not_configured",
    "Live WhatsApp requires a configured WABA id.",
  );
}

/**
 * The WABA id when one is configured, or null — for callers where its absence is NOT an error.
 *
 * The send-time template check is one: a sandbox send resolves to the fake provider and carries no
 * credentials at all, so there is no WABA and no template cache that could apply to it. Demanding one
 * there turned every credential-less send into `live_whatsapp_not_configured` — the template check
 * becoming the outage it exists to prevent.
 */
export function optionalWabaId(creds: Creds): string | null {
  const parsed = wabaCredentialSchema.safeParse(creds);
  return parsed.success ? parsed.data.waba_id : null;
}

export function isStale(syncedAt: Date): boolean {
  return Date.now() - syncedAt.getTime() > CACHE_MAX_AGE_MS;
}

/** Stable per-reason codes so a caller can branch, rather than one opaque "not approved". */
export function templateStatusCode(status: string): string {
  if (status === "PAUSED") return "whatsapp_template_paused";
  if (status === "REJECTED") return "whatsapp_template_rejected";
  if (status === "DISABLED") return "whatsapp_template_disabled";
  return "whatsapp_template_not_approved";
}

/** Raw `execute()` returns timestamptz as a STRING, not a Date — hence the widened input. */
export function dateFrom(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Meta's category vocabulary, mapped to ours. UTILITY / MARKETING / AUTHENTICATION today; Meta has
 * historically also used TRANSACTIONAL and OTP, and may add more.
 *
 * Anything unrecognised becomes null — never a guess. Null means "we do not know what class this
 * traffic is", and the callers treat that as a reason to stop rather than a reason to assume the
 * cheapest, least-restricted option. Guessing `utility` for an unmapped category would skip the
 * promotional consent check for whatever Meta actually approved.
 */
export function normalizeTemplateCategory(
  value: unknown,
): "marketing" | "utility" | "authentication" | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (code === "UTILITY") return "utility";
  if (code === "MARKETING") return "marketing";
  if (code === "AUTHENTICATION") return "authentication";
  return null;
}

import type { EmailVariantContent } from "@app/contracts";
import { type AppDb, applications, environments, type TenantId } from "@app/db";
import { and, eq } from "drizzle-orm";
import { notFound } from "../http/api-error.js";

/**
 * Pure/read helpers for MessagePreviewService, split out to keep the service under the file-length
 * guard. Behaviour is identical — no logic change from the inline versions.
 */

/**
 * The subject/text/html for a locale: the base variant for the default locale, or the locale override
 * merged onto the base (per-field). Returns null when a non-default locale has no override — reported as
 * `locale_not_supported`, mirroring the SMS path.
 */
export function resolveEmailParts(
  email: EmailVariantContent,
  loc: string,
  defaultLoc: string,
): {
  subject: string;
  text?: string | undefined;
  html?: string | undefined;
} | null {
  if (loc === defaultLoc) {
    return { subject: email.subject, text: email.text, html: email.html };
  }
  const override = email.locales?.[loc];
  if (!override) return null;
  return {
    subject: override.subject ?? email.subject,
    text: override.text ?? email.text,
    html: override.html ?? email.html,
  };
}

/** The default application's sandbox environment for a tenant (BFF-token fallback). */
export async function defaultSandboxEnv(
  tx: Parameters<Parameters<AppDb["withTenantDrizzle"]>[1]>[0],
  tenantId: string,
): Promise<string> {
  const [env] = await tx
    .select({ id: environments.id })
    .from(environments)
    .innerJoin(applications, eq(applications.id, environments.applicationId))
    .where(
      and(
        eq(applications.tenantId, tenantId as TenantId),
        eq(applications.slug, "default"),
        eq(environments.type, "sandbox"),
      ),
    )
    .limit(1);
  if (!env) {
    throw notFound(
      "environment_not_found",
      "No sandbox environment to preview against.",
    );
  }
  return env.id;
}

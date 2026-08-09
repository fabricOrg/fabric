import {
  currency,
  type WhatsappMessage,
  type WhatsappSendRequest,
  whatsappSendRequest,
} from "@app/contracts";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";

type Row = Record<string, unknown>;

export function parseWhatsappContent(raw: string): WhatsappSendRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const result = whatsappSendRequest.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function hydrateWhatsappRows(
  vault: PiiVaultService,
  tenantId: string,
  rows: readonly Row[],
): Promise<WhatsappMessage[]> {
  return Promise.all(
    rows.map(async (row) => {
      const to = await vault
        .readLatest(tenantId, String(row.subject_id), "phone")
        .catch(() => null);
      return {
        id: String(row.id),
        status: String(row.status) as WhatsappMessage["status"],
        to: to ? maskPhone(to) : "[erased]",
        provider: String(row.provider_slug),
        template_name: nullableString(row.template_name),
        template_language: nullableString(row.template_language),
        template_category: nullableString(
          row.template_category,
        ) as WhatsappMessage["template_category"],
        cost: {
          minor: String(row.cost_minor ?? "0"),
          currency: currency.parse(row.currency),
        },
        created_at:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
        error_code: nullableString(row.error_code),
      };
    }),
  );
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function maskPhone(value: string): string {
  if (value.length <= 6) return "[redacted]";
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

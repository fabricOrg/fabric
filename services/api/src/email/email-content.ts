import {
  type EmailMessage,
  type MessageStatus,
  type SendEmailRequest,
  sendEmailRequest,
} from "@app/contracts";

type Row = Record<string, unknown>;

/** Reads content-vault entries in bulk (the PII vault's readMany). */
interface ContentReader {
  readMany(
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string | null>>;
}

/** Map email_messages rows to the public DTO, decrypting to/from/subject from the content vault. */
export async function hydrateEmailRows(
  vault: ContentReader,
  tenantId: string,
  rows: Row[],
): Promise<EmailMessage[]> {
  const contentIds = rows.flatMap((row) =>
    row.content_pii_id ? [String(row.content_pii_id)] : [],
  );
  const contents = await vault.readMany(tenantId, contentIds);
  return rows.map((row) => {
    const raw = row.content_pii_id
      ? contents.get(String(row.content_pii_id))
      : null;
    const content = parseEmailContent(raw);
    return {
      id: String(row.id),
      status: String(row.status) as EmailMessage["status"],
      to: content?.to ?? "[erased]",
      from: content?.from ?? "[erased]",
      subject: content?.subject ?? "[erased]",
      provider: String(row.provider_slug),
      created_at: new Date(String(row.created_at)).toISOString(),
      error_code: row.error_code ? String(row.error_code) : null,
    };
  });
}

export function parseEmailContent(
  raw: string | null | undefined,
): SendEmailRequest | null {
  if (!raw) return null;
  try {
    const parsed = sendEmailRequest.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isTerminalEmailStatus(status: MessageStatus): boolean {
  return ["delivered", "undelivered", "failed", "expired"].includes(status);
}

import type { AppDb } from "@app/db";
import {
  emailBlindIndex,
  encryptPii,
  newDek,
  unwrapDek,
  wrapDek,
} from "./pii-crypto.js";
import { toBuffer, unsealRow } from "./pii-keys.js";

type Row = Record<string, unknown>;

export async function subjectForEmail(input: {
  db: AppDb;
  tenantId: string;
  email: string;
  masterKey: Buffer;
  indexKey: Buffer;
}): Promise<string> {
  const normalized = input.email.trim().toLowerCase();
  const index = emailBlindIndex(input.indexKey, input.tenantId, normalized);
  const existing = (await input.db.withTenant(
    input.tenantId,
    (tx) => tx`
      SELECT subject_id FROM data_subjects
      WHERE email_hash = ${index} AND erased_at IS NULL LIMIT 1`,
  )) as Row[];
  if (existing[0]?.subject_id) return String(existing[0].subject_id);

  return input.db.withTenant(input.tenantId, async (tx) => {
    const inserted = (await tx`
      INSERT INTO data_subjects (tenant_id, email_hash)
      VALUES (current_setting('app.tenant_id')::uuid, ${index})
      ON CONFLICT (tenant_id, email_hash)
        WHERE erased_at IS NULL AND email_hash IS NOT NULL DO NOTHING
      RETURNING subject_id`) as Row[];
    const raced = inserted[0]?.subject_id
      ? inserted[0].subject_id
      : (
          (await tx`
            SELECT subject_id FROM data_subjects
            WHERE email_hash = ${index} AND erased_at IS NULL LIMIT 1`) as Row[]
        )[0]?.subject_id;
    if (!raced) throw new Error("Could not resolve a data subject for email.");
    const id = String(raced);
    await tx`
      INSERT INTO dek_keys (tenant_id, subject_id, wrapped_dek, status)
      VALUES (
        current_setting('app.tenant_id')::uuid, ${id},
        ${wrapDek(input.masterKey, newDek(), input.tenantId, id)}, 'active'
      ) ON CONFLICT (subject_id) DO NOTHING`;
    const keys = (await tx`
      SELECT dek_id, wrapped_dek FROM dek_keys
      WHERE subject_id = ${id} AND status = 'active' LIMIT 1`) as Row[];
    const key = keys[0];
    if (!key?.wrapped_dek) {
      throw new Error("No active DEK for a freshly created email subject.");
    }
    const dek = unwrapDek(
      input.masterKey,
      toBuffer(key.wrapped_dek),
      input.tenantId,
      id,
    );
    await tx`
      INSERT INTO pii_vault (tenant_id, subject_id, kind, ciphertext, dek_id)
      SELECT current_setting('app.tenant_id')::uuid, ${id}, 'email',
             ${encryptPii(dek, normalized, input.tenantId, id, "email")},
             ${String(key.dek_id)}
      WHERE NOT EXISTS (
        SELECT 1 FROM pii_vault WHERE subject_id = ${id} AND kind = 'email'
      )`;
    return id;
  });
}

export async function readEmails(input: {
  db: AppDb;
  tenantId: string;
  subjectIds: readonly string[];
  masterKey: Buffer;
}): Promise<Map<string, string | null>> {
  if (input.subjectIds.length === 0) return new Map();
  const rows = (await input.db.withTenant(
    input.tenantId,
    (tx) => tx`
      SELECT DISTINCT ON (v.subject_id)
             v.subject_id, v.kind, v.ciphertext, k.wrapped_dek, k.status
      FROM pii_vault v JOIN dek_keys k ON k.dek_id = v.dek_id
      WHERE v.subject_id = ANY(${input.subjectIds as string[]}::uuid[])
        AND v.kind = 'email'
      ORDER BY v.subject_id, v.created_at DESC`,
  )) as Row[];
  const out = new Map<string, string | null>();
  for (const row of rows) {
    out.set(
      String(row.subject_id),
      unsealRow(input.masterKey, input.tenantId, row),
    );
  }
  return out;
}

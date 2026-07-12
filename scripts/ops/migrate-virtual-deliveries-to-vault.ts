/**
 * One-off backfill: move virtual-delivery PII out of the legacy platform-wide key and into the PII
 * vault (per-subject DEK), so that crypto-shred erasure actually reaches it.
 *
 * WHY THIS EXISTS: virtual deliveries originally encrypted the recipient and body under a single
 * VIRTUAL_PHONE_ENCRYPTION_KEY. A platform-wide key cannot be destroyed for one person, so an
 * erasure request could not make that data unreadable. Rows written under the old key are the only
 * ones that still need moving; new sends already write to the vault.
 *
 * Re-runnable: a row already carrying a subject_id is skipped, so an interrupted run resumes safely.
 * It never deletes the old ciphertext — a follow-up migration drops those columns once this has run
 * everywhere and the result has been eyeballed.
 *
 * Usage (needs BOTH keys — the old one to read, the new one to write):
 *   DATABASE_URL_SUPER=… VIRTUAL_PHONE_ENCRYPTION_KEY=… PII_MASTER_KEY=… \
 *     pnpm tsx scripts/ops/migrate-virtual-deliveries-to-vault.ts [--commit]
 *
 * Defaults to a DRY RUN: it reports what it would move and changes nothing. Pass --commit to write.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL_SUPER;
const legacySecret = process.env.VIRTUAL_PHONE_ENCRYPTION_KEY;
const masterSecret = process.env.PII_MASTER_KEY;
const commit = process.argv.includes("--commit");

if (!databaseUrl) throw new Error("DATABASE_URL_SUPER is required.");
if (!legacySecret) {
  throw new Error(
    "VIRTUAL_PHONE_ENCRYPTION_KEY is required — it is the ONLY way to read the legacy rows.",
  );
}
if (!masterSecret || masterSecret.length < 32) {
  throw new Error("PII_MASTER_KEY (>=32 chars) is required.");
}

const legacyKey = createHash("sha256").update(legacySecret).digest();
const masterKey = createHash("sha256")
  .update(`master:${masterSecret}`)
  .digest();
const indexKey = createHash("sha256").update(`index:${masterSecret}`).digest();

/** Legacy envelope: "v1.<iv>.<ciphertext>.<tag>", AAD = `${tenantId}:${messageId}`. */
function decryptLegacy(
  value: string,
  tenantId: string,
  messageId: string,
): string {
  const [version, iv, encrypted, tag] = value.split(".");
  if (version !== "v1" || !iv || !encrypted || !tag) {
    throw new Error("Invalid legacy ciphertext.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    legacyKey,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(`${tenantId}:${messageId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Vault envelope: iv ‖ tag ‖ ciphertext — must match services/api/src/privacy/pii-crypto.ts. */
function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function normalize(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

async function main(url: string) {
  const sql = postgres(url, { max: 1 });
  let moved = 0;
  let skipped = 0;
  const failures: string[] = [];
  try {
    const rows = await sql<
      Array<{
        message_id: string;
        tenant_id: string;
        recipient_ciphertext: string | null;
        body_ciphertext: string | null;
      }>
    >`
      SELECT message_id, tenant_id, recipient_ciphertext, body_ciphertext
      FROM virtual_deliveries
      WHERE subject_id IS NULL AND recipient_ciphertext IS NOT NULL
      ORDER BY created_at`;

    console.log(
      `${rows.length} legacy virtual deliveries to migrate${commit ? "" : " (DRY RUN — nothing will be written)"}`,
    );

    for (const row of rows) {
      try {
        const to = decryptLegacy(
          row.recipient_ciphertext ?? "",
          row.tenant_id,
          row.message_id,
        );
        const body = row.body_ciphertext
          ? decryptLegacy(row.body_ciphertext, row.tenant_id, row.message_id)
          : "";
        if (!commit) {
          console.log(
            `  would migrate ${row.message_id} (recipient ${to.slice(0, 6)}•••)`,
          );
          moved += 1;
          continue;
        }

        await sql.begin(async (tx) => {
          const phoneHash = createHmac("sha256", indexKey)
            .update(`${row.tenant_id}:${normalize(to)}`)
            .digest("hex");

          // Find-or-create the subject + its DEK, mirroring PiiVaultService.subjectForPhone.
          const [existing] = await tx<Array<{ subject_id: string }>>`
            SELECT subject_id FROM data_subjects
            WHERE tenant_id = ${row.tenant_id} AND phone_hash = ${phoneHash} LIMIT 1`;
          let subjectId = existing?.subject_id;
          let dekId: string;
          let dek: Buffer;

          if (subjectId) {
            const [key] = await tx<
              Array<{ dek_id: string; wrapped_dek: Buffer }>
            >`
              SELECT dek_id, wrapped_dek FROM dek_keys
              WHERE subject_id = ${subjectId} AND status = 'active' LIMIT 1`;
            if (!key) throw new Error(`subject ${subjectId} has no active DEK`);
            dekId = key.dek_id;
            const sealed = Buffer.from(key.wrapped_dek);
            const iv = sealed.subarray(0, 12);
            const tag = sealed.subarray(12, 28);
            const d = createDecipheriv("aes-256-gcm", masterKey, iv);
            d.setAAD(Buffer.from(`dek:${row.tenant_id}:${subjectId}`));
            d.setAuthTag(tag);
            dek = Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
          } else {
            const [created] = await tx<Array<{ subject_id: string }>>`
              INSERT INTO data_subjects (tenant_id, phone_hash)
              VALUES (${row.tenant_id}, ${phoneHash})
              RETURNING subject_id`;
            if (!created) throw new Error("subject insert returned no row");
            subjectId = created.subject_id;
            dek = randomBytes(32);
            const [key] = await tx<Array<{ dek_id: string }>>`
              INSERT INTO dek_keys (tenant_id, subject_id, wrapped_dek, status)
              VALUES (
                ${row.tenant_id}, ${subjectId},
                ${seal(masterKey, dek, `dek:${row.tenant_id}:${subjectId}`)}, 'active'
              )
              RETURNING dek_id`;
            if (!key) throw new Error("dek insert returned no row");
            dekId = key.dek_id;

            await tx`
              INSERT INTO pii_vault (tenant_id, subject_id, kind, ciphertext, dek_id)
              VALUES (
                ${row.tenant_id}, ${subjectId}, 'phone',
                ${seal(dek, Buffer.from(to, "utf8"), `${row.tenant_id}:${subjectId}:phone`)},
                ${dekId}
              )`;
          }

          const [bodyRow] = await tx<Array<{ id: string }>>`
            INSERT INTO pii_vault (tenant_id, subject_id, kind, ciphertext, dek_id)
            VALUES (
              ${row.tenant_id}, ${subjectId}, 'body',
              ${seal(dek, Buffer.from(body, "utf8"), `${row.tenant_id}:${subjectId}:body`)},
              ${dekId}
            )
            RETURNING id`;
          if (!bodyRow) throw new Error("body insert returned no row");

          await tx`
            UPDATE virtual_deliveries
            SET subject_id = ${subjectId}, body_pii_id = ${bodyRow.id}, updated_at = now()
            WHERE message_id = ${row.message_id}`;

          // The canonical message must reference the subject too — that is the whole surrogate rule.
          await tx`
            UPDATE messages SET subject_id = ${subjectId}
            WHERE id = ${row.message_id} AND subject_id IS NULL`;
        });
        moved += 1;
      } catch (error) {
        skipped += 1;
        failures.push(
          `${row.message_id}: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    console.log(`\nmigrated: ${moved}   failed: ${skipped}`);
    if (failures.length > 0) {
      console.log("failures (left untouched, safe to re-run):");
      for (const line of failures) console.log(`  ${line}`);
    }
    if (!commit && moved > 0) {
      console.log("\nDry run. Re-run with --commit to write.");
    }
  } finally {
    await sql.end();
  }
}

await main(databaseUrl);

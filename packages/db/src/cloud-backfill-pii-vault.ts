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
 *
 * It CLEARS the legacy ciphertext in the same transaction that writes the vault rows. Leaving the old
 * copy behind would keep the PII readable under the platform-wide key — the very exposure this exists
 * to close — so a half-migrated row is not an acceptable resting state. Atomic: either the vault holds
 * the data and the old copy is gone, or nothing changed.
 *
 * If a number was ALREADY erased, its legacy ciphertext is destroyed rather than migrated: that data
 * is what the person asked us to forget, and moving it into a fresh subject would un-erase them.
 *
 * WHERE IT RUNS: the deployed database is not publicly reachable, so this ships inside the api image
 * and runs as an in-VPC ECS task (`fabric-api-testing-pii-backfill`) — the only way to hand it the two
 * keys, since ECS run-task overrides can set `environment` but NOT `secrets`.
 *
 * Needs BOTH keys: the legacy one to READ the old rows, the master one to WRITE the vault.
 *   local:  DATABASE_URL_SUPER=… VIRTUAL_PHONE_ENCRYPTION_KEY=… PII_MASTER_KEY=… \
 *             pnpm tsx packages/db/src/cloud-backfill-pii-vault.ts [--commit]
 *   cloud:  aws ecs run-task … --overrides '{"containerOverrides":[{"name":"backfill","command":[
 *             "node","node_modules/@app/db/dist/cloud-backfill-pii-vault.js","--commit"]}]}'
 *
 * Defaults to a DRY RUN: it reports what it would move and changes nothing. Pass --commit to write.
 */
import { createDecipheriv, createHash } from "node:crypto";
import postgres from "postgres";
import {
  encryptPii,
  newDek,
  phoneBlindIndex,
  unwrapDek,
  wrapDek,
} from "./pii-envelope.js";

// Owner role in the cloud (the migration task uses the same); SUPER is the local equivalent.
const databaseUrl =
  process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL_SUPER;
const legacySecret = process.env.VIRTUAL_PHONE_ENCRYPTION_KEY;
const masterSecret = process.env.PII_MASTER_KEY;
const commit = process.argv.includes("--commit");

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL_OWNER (cloud) or DATABASE_URL_SUPER (local) is required.",
  );
}
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
          const phoneHash = phoneBlindIndex(indexKey, row.tenant_id, to);

          // HONOUR AN ERASURE THAT ALREADY HAPPENED. If this number has been erased and not since
          // re-contacted, its legacy ciphertext is data the person asked us to destroy — and it is
          // still readable under the old platform key, which is the very gap this backfill exists to
          // close. Migrating it into a fresh subject would UN-ERASE them. So: destroy it instead.
          const [erasedSubject] = await tx<Array<{ subject_id: string }>>`
            SELECT subject_id FROM data_subjects
            WHERE tenant_id = ${row.tenant_id} AND phone_hash = ${phoneHash}
              AND erased_at IS NOT NULL
            ORDER BY erased_at DESC LIMIT 1`;
          const [liveSubject] = await tx<Array<{ subject_id: string }>>`
            SELECT subject_id FROM data_subjects
            WHERE tenant_id = ${row.tenant_id} AND phone_hash = ${phoneHash}
              AND erased_at IS NULL
            LIMIT 1`;

          if (erasedSubject && !liveSubject) {
            // Point the delivery at the erased subject (so history resolves) and drop the plaintext
            // path entirely. No vault rows are written: there is no key to write them under, and the
            // person asked to be forgotten.
            await tx`
              UPDATE virtual_deliveries
              SET subject_id = ${erasedSubject.subject_id},
                  recipient_ciphertext = NULL,
                  body_ciphertext = NULL,
                  updated_at = now()
              WHERE message_id = ${row.message_id}`;
            await tx`
              UPDATE messages SET subject_id = ${erasedSubject.subject_id}
              WHERE id = ${row.message_id} AND subject_id IS NULL`;
            return;
          }

          // Find-or-create the LIVE subject + its DEK, mirroring PiiVaultService.subjectForPhone.
          let subjectId = liveSubject?.subject_id;
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
            dek = unwrapDek(
              masterKey,
              Buffer.from(key.wrapped_dek),
              row.tenant_id,
              subjectId,
            );
          } else {
            const [created] = await tx<Array<{ subject_id: string }>>`
              INSERT INTO data_subjects (tenant_id, phone_hash)
              VALUES (${row.tenant_id}, ${phoneHash})
              RETURNING subject_id`;
            if (!created) throw new Error("subject insert returned no row");
            subjectId = created.subject_id;
            dek = newDek();
            const [key] = await tx<Array<{ dek_id: string }>>`
              INSERT INTO dek_keys (tenant_id, subject_id, wrapped_dek, status)
              VALUES (
                ${row.tenant_id}, ${subjectId},
                ${wrapDek(masterKey, dek, row.tenant_id, subjectId)}, 'active'
              )
              RETURNING dek_id`;
            if (!key) throw new Error("dek insert returned no row");
            dekId = key.dek_id;

            await tx`
              INSERT INTO pii_vault (tenant_id, subject_id, kind, ciphertext, dek_id)
              VALUES (
                ${row.tenant_id}, ${subjectId}, 'phone',
                ${encryptPii(dek, to, row.tenant_id, subjectId, "phone")},
                ${dekId}
              )`;
          }

          const [bodyRow] = await tx<Array<{ id: string }>>`
            INSERT INTO pii_vault (tenant_id, subject_id, kind, ciphertext, dek_id)
            VALUES (
              ${row.tenant_id}, ${subjectId}, 'body',
              ${encryptPii(dek, body, row.tenant_id, subjectId, "body")},
              ${dekId}
            )
            RETURNING id`;
          if (!bodyRow) throw new Error("body insert returned no row");

          // Drop the legacy ciphertext in the SAME transaction that writes the vault rows. Leaving it
          // behind would keep this PII readable under the platform-wide key — the exact exposure this
          // backfill exists to close — so a half-migrated row is not an acceptable resting state.
          // Atomic: either the vault holds it and the old copy is gone, or nothing changed.
          await tx`
            UPDATE virtual_deliveries
            SET subject_id = ${subjectId}, body_pii_id = ${bodyRow.id},
                recipient_ciphertext = NULL, body_ciphertext = NULL,
                updated_at = now()
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

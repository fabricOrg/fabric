import type { AppDb } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_DB } from "../db/db.module.js";
import { notFound } from "../http/api-error.js";
import {
  encryptPii,
  newDek,
  phoneBlindIndex,
  unwrapDek,
  wrapDek,
} from "./pii-crypto.js";
import {
  indexKeyFrom,
  masterKeyFrom,
  toBuffer,
  unsealRow,
} from "./pii-keys.js";

type Row = Record<string, unknown>;

/** What a read returns when the subject's DEK has been destroyed — erased, not missing. */
export const ERASED = null;

export type PiiKind = "phone" | "body" | "attribute";

/**
 * The PII vault (COMPLIANCE §5). Raw personal data lives ONLY here, encrypted under a per-subject
 * DEK; everything else in the platform (messages, ledger, virtual deliveries) references the
 * `subject_id` surrogate. Erasure destroys the DEK, which makes that person's PII permanently
 * unreadable in one write while financial and audit history keeps its shape.
 *
 * Every method runs inside `withTenant` on app_runtime — the vault is tenant-scoped under FORCE RLS
 * like everything else, and there is no bypass path.
 */
@Injectable()
export class PiiVaultService {
  private readonly logger = new Logger(PiiVaultService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /**
   * Find-or-create the subject for a phone number, returning the surrogate the rest of the platform
   * stores. Idempotent on the blind index, so concurrent sends to the same recipient converge on one
   * subject instead of racing to create two.
   */
  async subjectForPhone(tenantId: string, e164: string): Promise<string> {
    const index = phoneBlindIndex(this.indexKey(), tenantId, e164);
    const existing = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      SELECT subject_id FROM data_subjects WHERE phone_hash = ${index} LIMIT 1`,
    )) as Row[];
    const found = existing[0]?.subject_id;
    if (found) return String(found);

    const subjectId = await this.db.withTenant(tenantId, async (tx) => {
      const inserted = (await tx`
        INSERT INTO data_subjects (tenant_id, phone_hash)
        VALUES (current_setting('app.tenant_id')::uuid, ${index})
        ON CONFLICT (tenant_id, phone_hash) DO NOTHING
        RETURNING subject_id`) as Row[];
      // Lost the race: another request created the subject between our SELECT and INSERT.
      const id = inserted[0]?.subject_id
        ? String(inserted[0].subject_id)
        : String(
            (
              (await tx`
          SELECT subject_id FROM data_subjects WHERE phone_hash = ${index} LIMIT 1`) as Row[]
            )[0]?.subject_id,
          );
      const dek = newDek();
      await tx`
        INSERT INTO dek_keys (tenant_id, subject_id, wrapped_dek, status)
        VALUES (
          current_setting('app.tenant_id')::uuid, ${id},
          ${wrapDek(this.masterKey(), dek, tenantId, id)}, 'active'
        )
        ON CONFLICT DO NOTHING`;
      return id;
    });

    // The number itself is PII: store it in the vault under the subject's own DEK, so erasure
    // reaches it. The blind index stays behind — it is one-way and identifies, it does not reveal.
    await this.put(tenantId, subjectId, "phone", e164);
    return subjectId;
  }

  /** Seal one piece of PII under the subject's DEK. Returns the vault row id to reference. */
  async put(
    tenantId: string,
    subjectId: string,
    kind: PiiKind,
    value: string,
  ): Promise<string> {
    const key = await this.activeDek(tenantId, subjectId);
    if (!key) {
      throw notFound(
        "subject_erased",
        "This data subject has been erased; new personal data cannot be stored against it.",
      );
    }
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      INSERT INTO pii_vault (tenant_id, subject_id, kind, ciphertext, dek_id)
      VALUES (
        current_setting('app.tenant_id')::uuid, ${subjectId}, ${kind},
        ${encryptPii(key.dek, value, tenantId, subjectId, kind)}, ${key.dekId}
      )
      RETURNING id`,
    )) as Row[];
    const id = rows[0]?.id;
    if (!id) throw new Error("PII vault insert returned no row.");
    return String(id);
  }

  /**
   * Read one vault row. Returns `ERASED` (null) when the subject's DEK is gone — an erased value is
   * a first-class outcome the caller renders, never an exception and never a 500.
   */
  async read(tenantId: string, piiId: string): Promise<string | null> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      SELECT v.subject_id, v.kind, v.ciphertext, k.wrapped_dek, k.status
      FROM pii_vault v
      JOIN dek_keys k ON k.dek_id = v.dek_id
      WHERE v.id = ${piiId}
      LIMIT 1`,
    )) as Row[];
    const row = rows[0];
    if (!row) return ERASED;
    return this.unseal(tenantId, row);
  }

  /** Read the newest value of a kind for a subject (the recipient's number, typically). */
  async readLatest(
    tenantId: string,
    subjectId: string,
    kind: PiiKind,
  ): Promise<string | null> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      SELECT v.subject_id, v.kind, v.ciphertext, k.wrapped_dek, k.status
      FROM pii_vault v
      JOIN dek_keys k ON k.dek_id = v.dek_id
      WHERE v.subject_id = ${subjectId} AND v.kind = ${kind}
      ORDER BY v.created_at DESC
      LIMIT 1`,
    )) as Row[];
    const row = rows[0];
    if (!row) return ERASED;
    return this.unseal(tenantId, row);
  }

  /**
   * Batch-read vault rows by id. One query, not one per row: an inbox page of 100 messages must not
   * become 100 round trips. Erased or unreadable rows come back as `ERASED`, not as a missing key.
   */
  async readMany(
    tenantId: string,
    piiIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    if (piiIds.length === 0) return new Map();
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      SELECT v.id, v.subject_id, v.kind, v.ciphertext, k.wrapped_dek, k.status
      FROM pii_vault v
      JOIN dek_keys k ON k.dek_id = v.dek_id
      WHERE v.id = ANY(${piiIds as string[]}::uuid[])`,
    )) as Row[];
    const out = new Map<string, string | null>();
    for (const row of rows) {
      out.set(String(row.id), this.unseal(tenantId, row));
    }
    return out;
  }

  /** Batch-read the current phone number for each subject — same one-query rule as readMany. */
  async readPhones(
    tenantId: string,
    subjectIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    if (subjectIds.length === 0) return new Map();
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      SELECT DISTINCT ON (v.subject_id)
             v.subject_id, v.kind, v.ciphertext, k.wrapped_dek, k.status
      FROM pii_vault v
      JOIN dek_keys k ON k.dek_id = v.dek_id
      WHERE v.subject_id = ANY(${subjectIds as string[]}::uuid[]) AND v.kind = 'phone'
      ORDER BY v.subject_id, v.created_at DESC`,
    )) as Row[];
    const out = new Map<string, string | null>();
    for (const row of rows) {
      out.set(String(row.subject_id), this.unseal(tenantId, row));
    }
    return out;
  }

  /**
   * ERASURE (crypto-shred). Destroys the subject's DEK, which renders every piece of their PII
   * permanently unreadable — the ciphertext rows stay, the key does not. Ledger entries, message
   * history, and audit keep their `subject_id` surrogate and their amounts, which is exactly the
   * point: we honour erasure without editing append-only financial records.
   *
   * Idempotent: erasing an already-erased subject is a no-op that still records the request.
   */
  async erase(input: {
    tenantId: string;
    subjectId: string;
    requestedBy: string;
    basis: string;
  }): Promise<{ erased: boolean }> {
    const { tenantId, subjectId, requestedBy, basis } = input;
    const erased = await this.db.withTenant(tenantId, async (tx) => {
      const subject = (await tx`
        SELECT subject_id FROM data_subjects WHERE subject_id = ${subjectId} LIMIT 1`) as Row[];
      if (!subject[0]) {
        throw notFound("subject_not_found", "No such data subject.");
      }
      const destroyed = (await tx`
        UPDATE dek_keys
        SET wrapped_dek = NULL, status = 'destroyed', destroyed_at = now(), updated_at = now()
        WHERE subject_id = ${subjectId} AND status = 'active'
        RETURNING dek_id`) as Row[];
      // The erasure record is written in the SAME transaction as the key destruction, and survives
      // it — proof the request was honoured, retained for years after the data is gone.
      await tx`
        INSERT INTO erasure_log (tenant_id, subject_id, requested_by, basis, completed_at)
        VALUES (
          current_setting('app.tenant_id')::uuid, ${subjectId},
          ${requestedBy}, ${basis}, now()
        )`;
      return destroyed.length > 0;
    });
    this.logger.log(
      `erasure completed for subject ${subjectId} (tenant ${tenantId}); keys destroyed: ${erased}`,
    );
    return { erased };
  }

  /** Logs the corrupt-row case the pure unsealer swallows, then degrades. */
  private unseal(tenantId: string, row: Row): string | null {
    const value = unsealRow(this.masterKey(), tenantId, row);
    if (value === null && row.status === "active" && row.wrapped_dek) {
      this.logger.error(
        `vault decrypt failed for subject ${String(row.subject_id)} — row is unreadable`,
      );
    }
    return value;
  }

  private async activeDek(
    tenantId: string,
    subjectId: string,
  ): Promise<{ dek: Buffer; dekId: string } | null> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      SELECT dek_id, wrapped_dek FROM dek_keys
      WHERE subject_id = ${subjectId} AND status = 'active'
      LIMIT 1`,
    )) as Row[];
    const row = rows[0];
    if (!row?.wrapped_dek) return null;
    return {
      dek: unwrapDek(
        this.masterKey(),
        toBuffer(row.wrapped_dek),
        tenantId,
        subjectId,
      ),
      dekId: String(row.dek_id),
    };
  }

  private masterKey(): Buffer {
    return masterKeyFrom(this.config);
  }

  private indexKey(): Buffer {
    return indexKeyFrom(this.config);
  }
}

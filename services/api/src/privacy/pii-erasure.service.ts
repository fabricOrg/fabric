import type { AppDb } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuditService } from "../audit/audit.service.js";
import { APP_DB } from "../db/db.module.js";
import { notFound } from "../http/api-error.js";
import { maskMsisdn, phoneBlindIndex } from "./pii-crypto.js";
import { indexKeyFrom } from "./pii-keys.js";

type Row = Record<string, unknown>;

/**
 * DATA-SUBJECT RIGHTS (COMPLIANCE §6) — the operator-facing half of the vault.
 *
 * Erasure is crypto-shredding: destroy the subject's DEK and every piece of their PII becomes
 * permanently unreadable in one write, while the append-only ledger, delivery history, and audit
 * keep their `subject_id` surrogate and their amounts. We honour "delete my data" without editing
 * financial records — which is the whole reason the vault exists.
 *
 * Separate from PiiVaultService on purpose: that one STORES and READS personal data on the send
 * path; this one DESTROYS it on a human's instruction. Different callers, different blast radius.
 */
@Injectable()
export class PiiErasureService {
  private readonly logger = new Logger(PiiErasureService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Crypto-shred one subject. Idempotent: erasing an already-erased subject destroys nothing further
   * but still records the request, because a DSR that was asked for twice was still asked for twice.
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
      // Close the subject in the same breath as destroying its key. It keeps its blind index (so
      // history still resolves) but leaves the LIVE lookup — which is what allows the number to be
      // contacted again later under a NEW subject, instead of failing forever against a dead key.
      await tx`
        UPDATE data_subjects
        SET erased_at = COALESCE(erased_at, now()), updated_at = now()
        WHERE subject_id = ${subjectId}`;
      // Managed deliveries carry CALLER-supplied reference/metadata (order ids, names — personal
      // data the vault never saw). Crypto-shredding cannot reach them, so the same transaction
      // scrubs them on every delivery addressed to this subject. Status, cost, and the ledger
      // stay — we honour the DSR without editing financial history (SDK-005 deletion handling).
      const scrubbed = (await tx`
        UPDATE message_deliveries d
        SET reference = NULL, metadata = '{}'::jsonb, updated_at = now()
        FROM message_delivery_attempts a
        JOIN messages m ON m.id = a.message_id
        WHERE a.delivery_id = d.id AND m.subject_id = ${subjectId}
        RETURNING d.id`) as Row[];
      // The erasure record is written in the SAME transaction as the key destruction, and survives
      // it — proof the request was honoured, retained for years after the data itself is gone.
      await tx`
        INSERT INTO erasure_log (tenant_id, subject_id, requested_by, basis, completed_at)
        VALUES (
          current_setting('app.tenant_id')::uuid, ${subjectId},
          ${requestedBy}, ${basis}, now()
        )`;
      return { destroyed: destroyed.length > 0, scrubbed: scrubbed.length };
    });

    // COMPLIANCE §6: every DSR action is audited. erasure_log is the legal proof that the request
    // was honoured; the audit trail is the operational record of WHICH staff member did it.
    await this.audit.record({
      actorEmail: requestedBy,
      action: "privacy.subject.erased",
      targetType: "data_subject",
      targetId: subjectId,
      summary: `Data subject crypto-shredded (${erased.destroyed ? "key destroyed" : "already erased"}).`,
      metadata: {
        tenant_id: tenantId,
        basis,
        keys_destroyed: erased.destroyed,
        managed_deliveries_scrubbed: erased.scrubbed,
      },
    });
    this.logger.log(
      `erasure completed for subject ${subjectId} (tenant ${tenantId}); keys destroyed: ${erased.destroyed}; deliveries scrubbed: ${erased.scrubbed}`,
    );
    return { erased: erased.destroyed };
  }

  /**
   * Operator entry point: erase by phone number. Staff hold a number, not a surrogate — the blind
   * index resolves one to the other without the vault ever revealing anything.
   */
  async eraseByPhone(input: {
    tenantId: string;
    e164: string;
    requestedBy: string;
    basis: string;
  }): Promise<{ erased: boolean; subjectId: string }> {
    const { tenantId, e164, requestedBy, basis } = input;
    const subjectId = await this.liveSubjectFor(tenantId, e164);
    if (!subjectId) {
      throw notFound(
        "subject_not_found",
        "This workspace holds no personal data for that number.",
      );
    }
    const result = await this.erase({
      tenantId,
      subjectId,
      requestedBy,
      basis,
    });
    return { ...result, subjectId };
  }

  /**
   * What do we hold on this person? Returns the KINDS held and whether they are still readable —
   * deliberately not the values, so an operator answering a DSR never spills PII into a log or a
   * screenshot. Access-export (the values themselves) is a separate, separately-audited action.
   */
  async subjectSummary(
    tenantId: string,
    e164: string,
  ): Promise<{
    subject_id: string;
    msisdn_masked: string;
    kinds: string[];
    managed_deliveries: number;
    erased: boolean;
  } | null> {
    const index = phoneBlindIndex(indexKeyFrom(this.config), tenantId, e164);
    const { rows, managedDeliveries } = await this.db.withTenant(
      tenantId,
      async (tx) => {
        const subjectRows = (await tx`
          SELECT s.subject_id, s.erased_at, v.kind
          FROM data_subjects s
          LEFT JOIN pii_vault v ON v.subject_id = s.subject_id
          WHERE s.phone_hash = ${index}
          ORDER BY s.created_at DESC`) as Row[];
        const newest = subjectRows[0]?.subject_id
          ? String(subjectRows[0].subject_id)
          : null;
        // The DSR answer must cover managed deliveries too — their caller-supplied
        // reference/metadata is personal data the vault never held.
        const counted = newest
          ? ((await tx`
              SELECT count(DISTINCT d.id)::int AS n
              FROM message_deliveries d
              JOIN message_delivery_attempts a ON a.delivery_id = d.id
              JOIN messages m ON m.id = a.message_id
              WHERE m.subject_id = ${newest}`) as Row[])
          : [];
        return {
          rows: subjectRows,
          managedDeliveries: Number(counted[0]?.n ?? 0),
        };
      },
    );
    const first = rows[0];
    if (!first) return null;
    // Newest subject for this number wins — an erased predecessor may sit behind it.
    const subjectId = String(first.subject_id);
    return {
      subject_id: subjectId,
      msisdn_masked: maskMsisdn(e164),
      kinds: [
        ...new Set(
          rows
            .filter((row) => String(row.subject_id) === subjectId && row.kind)
            .map((row) => String(row.kind)),
        ),
      ],
      managed_deliveries: managedDeliveries,
      erased: first.erased_at !== null,
    };
  }

  private async liveSubjectFor(
    tenantId: string,
    e164: string,
  ): Promise<string | null> {
    const index = phoneBlindIndex(indexKeyFrom(this.config), tenantId, e164);
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      SELECT subject_id FROM data_subjects
      WHERE phone_hash = ${index} AND erased_at IS NULL
      LIMIT 1`,
    )) as Row[];
    const id = rows[0]?.subject_id;
    return id ? String(id) : null;
  }
}

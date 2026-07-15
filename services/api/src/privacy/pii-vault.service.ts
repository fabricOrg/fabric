import type { AppDb } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_DB } from "../db/db.module.js";
import { notFound } from "../http/api-error.js";
import { encryptPii, unwrapDek } from "./pii-crypto.js";
import {
  indexKeyFrom,
  masterKeyFrom,
  toBuffer,
  unsealRow,
} from "./pii-keys.js";
import {
  readEmails as readEmailSubjects,
  subjectForEmail as resolveEmailSubject,
} from "./pii-vault-email.js";
import {
  findSubjectForPhone as findPhoneSubject,
  readPhones as readPhoneSubjects,
  subjectForPhone as resolvePhoneSubject,
} from "./pii-vault-phone.js";

type Row = Record<string, unknown>;
export const ERASED = null;
export type PiiKind = "phone" | "email" | "body" | "attribute";

@Injectable()
export class PiiVaultService {
  private readonly logger = new Logger(PiiVaultService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async subjectForPhone(tenantId: string, e164: string): Promise<string> {
    return resolvePhoneSubject({
      db: this.db,
      tenantId,
      e164,
      masterKey: this.masterKey(),
      indexKey: this.indexKey(),
    });
  }

  async findSubjectForPhone(
    tenantId: string,
    e164: string,
  ): Promise<string | null> {
    return findPhoneSubject({
      db: this.db,
      tenantId,
      e164,
      indexKey: this.indexKey(),
    });
  }

  async subjectForEmail(tenantId: string, email: string): Promise<string> {
    return resolveEmailSubject({
      db: this.db,
      tenantId,
      email,
      masterKey: this.masterKey(),
      indexKey: this.indexKey(),
    });
  }

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
        ) RETURNING id`,
    )) as Row[];
    if (!rows[0]?.id) throw new Error("PII vault insert returned no row.");
    return String(rows[0].id);
  }

  async read(tenantId: string, piiId: string): Promise<string | null> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT v.subject_id, v.kind, v.ciphertext, k.wrapped_dek, k.status
        FROM pii_vault v JOIN dek_keys k ON k.dek_id = v.dek_id
        WHERE v.id = ${piiId} LIMIT 1`,
    )) as Row[];
    return rows[0] ? this.unseal(tenantId, rows[0]) : ERASED;
  }

  async readLatest(
    tenantId: string,
    subjectId: string,
    kind: PiiKind,
  ): Promise<string | null> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT v.subject_id, v.kind, v.ciphertext, k.wrapped_dek, k.status
        FROM pii_vault v JOIN dek_keys k ON k.dek_id = v.dek_id
        WHERE v.subject_id = ${subjectId} AND v.kind = ${kind}
        ORDER BY v.created_at DESC LIMIT 1`,
    )) as Row[];
    return rows[0] ? this.unseal(tenantId, rows[0]) : ERASED;
  }

  async readMany(
    tenantId: string,
    piiIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    if (piiIds.length === 0) return new Map();
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT v.id, v.subject_id, v.kind, v.ciphertext, k.wrapped_dek, k.status
        FROM pii_vault v JOIN dek_keys k ON k.dek_id = v.dek_id
        WHERE v.id = ANY(${piiIds as string[]}::uuid[])`,
    )) as Row[];
    const out = new Map<string, string | null>();
    for (const row of rows) {
      out.set(String(row.id), this.unseal(tenantId, row));
    }
    return out;
  }

  async readPhones(
    tenantId: string,
    subjectIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    return readPhoneSubjects({
      db: this.db,
      tenantId,
      subjectIds,
      masterKey: this.masterKey(),
    });
  }

  async readEmails(
    tenantId: string,
    subjectIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    return readEmailSubjects({
      db: this.db,
      tenantId,
      subjectIds,
      masterKey: this.masterKey(),
    });
  }

  private unseal(tenantId: string, row: Row): string | null {
    const value = unsealRow(this.masterKey(), tenantId, row);
    if (value === null && row.status === "active" && row.wrapped_dek) {
      this.logger.error(
        `vault decrypt failed for subject ${String(row.subject_id)}; row is unreadable`,
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
        WHERE subject_id = ${subjectId} AND status = 'active' LIMIT 1`,
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

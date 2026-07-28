import { createHash } from "node:crypto";
import type { ConfigurePluginRequest } from "@app/contracts";
import {
  credentialFingerprint,
  encryptCredential,
  newCredentialDek,
  type ProvisioningDb,
  pluginCredentials,
  pluginInstances,
  wrapCredentialDek,
} from "@app/db";
import { adapterConfigSchemaFor } from "@app/integrations";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { desc, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";

interface Actor {
  readonly email: string;
  readonly staffId?: string | null;
}

/**
 * Installing and rotating the secrets a plugin instance needs (ADR-0011 §1).
 *
 * The plaintext exists in this process only long enough to be sealed. It is never returned by any
 * read, never audited, and never logged — including in error messages, where a validation failure
 * names the missing FIELD and never echoes a value.
 */
@Injectable()
export class PluginCredentialsService {
  private readonly logger = new Logger(PluginCredentialsService.name);

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Seal a credential document against an instance and make it the active one.
   *
   * Rotation is an INSERT at the next version, not an update: the superseded row survives until it
   * is pruned, so a bad rotation is recoverable. The AAD binds each ciphertext to instance AND
   * version, which is what stops the old blob decrypting against the record that replaced it.
   */
  async configure(
    id: string,
    request: ConfigurePluginRequest,
    actor: Actor,
  ): Promise<{ fingerprint: string; version: number }> {
    const [instance] = await this.provisioning.db
      .select()
      .from(pluginInstances)
      .where(eq(pluginInstances.id, id))
      .limit(1);
    if (!instance) {
      throw notFound("plugin_instance_not_found", "Unknown plugin instance.");
    }
    this.assertMatchesAdapterSchema(
      instance.capability,
      instance.vendor,
      request.credential,
    );

    const masterKey = this.masterKey();
    const [latest] = await this.provisioning.db
      .select({ version: pluginCredentials.version })
      .from(pluginCredentials)
      .where(eq(pluginCredentials.pluginInstanceId, id))
      .orderBy(desc(pluginCredentials.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;

    const dek = newCredentialDek();
    const dekWrapped = wrapCredentialDek(masterKey, dek, id, version);
    const ciphertext = encryptCredential(dek, request.credential, id, version);
    // Fingerprint the PRIMARY secret so staff can tell which key is installed. Falls back to the
    // whole document when an adapter has no obvious primary field.
    const primary =
      request.credential.apiKey ??
      request.credential.secretKey ??
      JSON.stringify(request.credential);
    const fingerprint = credentialFingerprint(primary);

    const [created] = await this.provisioning.db
      .insert(pluginCredentials)
      .values({
        pluginInstanceId: id,
        version,
        dekWrapped,
        ciphertext,
        fingerprint,
      })
      .returning({ id: pluginCredentials.id });
    if (!created) throw new Error("Credential insert returned no row.");

    await this.provisioning.db
      .update(pluginInstances)
      .set({ credentialsRef: created.id, updatedAt: new Date() })
      .where(eq(pluginInstances.id, id));

    // Fingerprint + version only. Never the secret, never its length, never a prefix.
    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email,
      action: "plugin.credential_configured",
      targetType: "plugin_instance",
      targetId: id,
      summary: `Credential installed for ${instance.vendor} (${instance.mode}) v${version}`,
      reason: null,
      metadata: { vendor: instance.vendor, version, fingerprint },
    });
    this.logger.log(
      `plugin credential installed: ${instance.vendor}/${instance.mode} v${version} fp=${fingerprint}`,
    );
    return { fingerprint, version };
  }

  /** The installed credential's fingerprint, or null when none is configured. */
  async fingerprintFor(credentialsRef: string | null): Promise<string | null> {
    if (!credentialsRef) return null;
    const [row] = await this.provisioning.db
      .select({
        fingerprint: pluginCredentials.fingerprint,
        dekWrapped: pluginCredentials.dekWrapped,
      })
      .from(pluginCredentials)
      .where(eq(pluginCredentials.id, credentialsRef))
      .limit(1);
    // A NULL dek_wrapped is a REVOKED credential — report it as absent rather than showing a
    // fingerprint for a secret that can no longer be read.
    if (!row?.dekWrapped) return null;
    return row.fingerprint;
  }

  /**
   * Validate against the adapter's own declared shape, so an Arkesel instance cannot be saved
   * without an `apiKey` and then fail at send time with a confusing provider error.
   */
  private assertMatchesAdapterSchema(
    capability: string,
    vendor: string,
    credential: Record<string, string>,
  ): void {
    // EVERY capability, not just SMS. Skipping validation here is how a Paystack instance could be
    // saved holding `apiKey` when its adapter requires `secretKey`: stored, fingerprinted, reported
    // as configured, and unusable at charge time.
    const schema = adapterConfigSchemaFor(capability, vendor) as {
      required?: unknown;
      properties?: Record<string, unknown>;
    } | null;
    if (!schema) {
      throw invalidRequest(
        "vendor_not_supported",
        `This build has no ${capability} adapter for '${vendor}', so it cannot be configured.`,
        "vendor",
      );
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const field of required) {
      const name = String(field);
      if (!credential[name]?.trim()) {
        throw invalidRequest(
          "missing_credential_field",
          `'${name}' is required for ${vendor}.`,
          name,
        );
      }
    }
  }

  /**
   * Derived, not truncated — same rationale as the PII vault and the resolver: a configured secret
   * is usually ASCII, so slicing bytes off it keeps roughly a byte of entropy per character.
   *
   * MUST stay identical to PluginResolverService.masterKey(), or a credential sealed here cannot be
   * opened on the send path. Same purpose label, same digest.
   */
  private masterKey(): Buffer {
    const secret = this.config.get<string>("PLUGIN_MASTER_KEY")?.trim();
    if (!secret || secret.length < 32) {
      if (this.config.get<string>("NODE_ENV") === "production") {
        throw new Error(
          "PLUGIN_MASTER_KEY must be set to at least 32 characters in production.",
        );
      }
      this.logger.warn(
        "PLUGIN_MASTER_KEY unset — using the local development key; credentials are NOT protected",
      );
      return createHash("sha256")
        .update("fabric-local-plugin-development-key")
        .digest();
    }
    return createHash("sha256").update(`plugin-master:${secret}`).digest();
  }
}

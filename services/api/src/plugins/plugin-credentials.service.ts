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
import {
  adapterConfigSchemaFor,
  credentialModeViolation,
} from "@app/integrations";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { desc, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { derivePluginMasterKey } from "./plugin-master-key.js";
import { PluginResolverService } from "./plugin-resolver.service.js";

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
    // Optional so tests can construct this service without a resolver; when present, a write here
    // drops its cache immediately rather than letting a superseded credential live out the TTL.
    @Optional()
    @Inject(PluginResolverService)
    private readonly resolver?: PluginResolverService,
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
    // The credential must also AGREE with the instance's mode. Presence alone lets a live Arkesel
    // instance omit sandbox='false' (accepted, never delivered, still billed) or a sandbox Paystack
    // instance hold sk_live_ (real charges from a test workspace).
    const violation = credentialModeViolation(
      instance.capability,
      instance.vendor,
      instance.mode,
      request.credential,
    );
    if (violation) {
      throw invalidRequest("credential_mode_mismatch", violation, "credential");
    }

    const masterKey = derivePluginMasterKey(this.config, this.logger);
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
    // Drop the resolver's 30s cache NOW. Without this a rotated key keeps being used for up to the
    // TTL — and a rotation is often a response to compromise, where "eventually" is the wrong
    // answer. NOTE: this clears THIS process's cache; other API replicas still age out on their own
    // TTL, so a rotation is not instantaneous fleet-wide.
    this.resolver?.invalidate();
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
}

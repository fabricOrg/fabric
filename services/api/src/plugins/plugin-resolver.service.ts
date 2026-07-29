import {
  decryptCredential,
  type ProvisioningDb,
  pluginCredentials,
  pluginInstances,
  unwrapCredentialDek,
} from "@app/db";
import type {
  Creds,
  EmailSenderPlugin,
  PaymentProviderPlugin,
  SmsSenderPlugin,
} from "@app/integrations";
import {
  emailAdapterFor,
  paymentAdapterFor,
  smsAdapterFor,
} from "@app/integrations";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, asc, eq, isNull } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { derivePluginMasterKey } from "./plugin-master-key.js";
import {
  type PaymentWebhookCredential,
  paymentWebhookCredentials,
} from "./plugin-webhook-credentials.js";

/** A resolved provider: the adapter plus the credentials it needs. */
export interface ResolvedProvider {
  readonly vendor: string;
  readonly instanceId: string;
  readonly provider: SmsSenderPlugin;
  readonly creds: Creds;
  /** Which credential version supplied `creds` — recorded by callers that must verify later. */
  readonly credentialVersion: number;
}

/** A resolved PAYMENT provider. Same shape, different adapter contract. */
export interface ResolvedPaymentProvider {
  readonly vendor: string;
  readonly instanceId: string;
  readonly provider: PaymentProviderPlugin;
  readonly creds: Creds;
  /** Stored on the payment intent so its webhook still verifies after a key rotation. */
  readonly credentialVersion: number;
}

export interface ResolvedEmailProvider {
  readonly vendor: string;
  readonly instanceId: string;
  readonly provider: EmailSenderPlugin;
  readonly creds: Creds;
  readonly credentialVersion: number;
}

interface CacheEntry {
  readonly resolved:
    | ResolvedProvider
    | ResolvedPaymentProvider
    | ResolvedEmailProvider
    | null;
  readonly at: number;
}

/**
 * How long a resolution is trusted before re-reading the control plane.
 *
 * Principle #7: the control plane is never in the hot path. Without this, every send would join a
 * provisioning-database read, and a control-plane blip would become a sending outage. Short enough
 * that enabling a provider takes effect in seconds, long enough that a burst costs one query.
 */
const TTL_MS = 30_000;

/**
 * Resolves which provider handles a send, from control-plane config rather than environment
 * variables (ADR-0011).
 *
 * FAILS CLOSED, deliberately. If the control plane is unreachable and nothing is cached, a live
 * send raises instead of falling back. The tempting fallback — "use the fake provider" — would
 * report `accepted` for a message that never left the building, which is exactly the failure that
 * made a sandbox worker look like a successful live send during the first Arkesel test. A refused
 * send is recoverable; a silently fabricated one is not.
 *
 * Last-known-good IS served when the store fails after a successful read, because that config was
 * true seconds ago and a transient database error should not stop a working integration.
 */
@Injectable()
export class PluginResolverService {
  private readonly logger = new Logger(PluginResolverService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /**
   * The provider for an SMS send in this mode, or null when none is configured. Callers treat null
   * as "cannot send" — never as "send some other way".
   */
  async resolveSms(mode: "sandbox" | "live"): Promise<ResolvedProvider | null> {
    return this.resolveCached("sms", mode) as Promise<ResolvedProvider | null>;
  }

  /**
   * The payment processor for this mode, or null when none is configured. A sandbox workspace
   * resolves the instance holding test keys, a live one the instance holding live keys — they are
   * separate rows, so a test charge can never be attempted with live credentials or vice versa.
   */
  async resolvePayment(
    mode: "sandbox" | "live",
  ): Promise<ResolvedPaymentProvider | null> {
    return this.resolveCached(
      "payment",
      mode,
    ) as Promise<ResolvedPaymentProvider | null>;
  }

  async resolveEmail(
    mode: "sandbox" | "live",
  ): Promise<ResolvedEmailProvider | null> {
    return this.resolveCached(
      "email",
      mode,
    ) as Promise<ResolvedEmailProvider | null>;
  }

  /**
   * The shared cache + failure posture for every capability. Identical rules whichever provider you
   * are resolving: short TTL so the control plane stays off the hot path, last-known-good on a blip,
   * and FAIL CLOSED with nothing cached rather than guessing a provider.
   */
  private async resolveCached(
    capability: "sms" | "email" | "payment",
    mode: "sandbox" | "live",
  ): Promise<
    ResolvedProvider | ResolvedEmailProvider | ResolvedPaymentProvider | null
  > {
    const key = `${capability}:${mode}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.resolved;

    try {
      const resolved = await this.read(capability, mode);
      this.cache.set(key, { resolved, at: Date.now() });
      return resolved;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (cached) {
        // Serve last-known-good: this config was valid moments ago, and a database blip must not
        // take a working provider offline.
        this.logger.error(
          `plugin resolution failed for ${key} — serving last-known-good: ${message}`,
        );
        return cached.resolved;
      }
      // Nothing cached and the store is unreachable. Refuse rather than guess.
      this.logger.error(
        `plugin resolution failed for ${key} with no cached value — failing closed: ${message}`,
      );
      throw error;
    }
  }

  /** Drop cached resolutions so a control-plane change takes effect immediately. */
  invalidate(): void {
    this.cache.clear();
  }

  /**
   * Every credential a PAYMENT webhook could legitimately be signed with. Split into its own module
   * for the file-length guard; see plugin-webhook-credentials.ts for why previous versions count.
   */
  paymentWebhookCredentials(): Promise<PaymentWebhookCredential[]> {
    return paymentWebhookCredentials(
      this.provisioning,
      this.config,
      this.logger,
    );
  }

  private async read(
    capability: "sms" | "email" | "payment",
    mode: "sandbox" | "live",
  ): Promise<
    ResolvedProvider | ResolvedEmailProvider | ResolvedPaymentProvider | null
  > {
    // Enabled instances for this capability+mode, primary (priority 0) first — the failover chain.
    // The first one with a usable adapter AND readable credentials wins; a misconfigured primary
    // falls through to its backup rather than taking sending down.
    const rows = await this.provisioning.db
      .select({
        id: pluginInstances.id,
        vendor: pluginInstances.vendor,
        credentialsRef: pluginInstances.credentialsRef,
      })
      .from(pluginInstances)
      .where(
        and(
          eq(pluginInstances.capability, capability),
          eq(pluginInstances.mode, mode),
          eq(pluginInstances.enabled, true),
          // PLATFORM-WIDE only. Slice 3 made per-tenant instances expressible (nullable tenant_id);
          // without this filter the first tenant-scoped row would silently start carrying every
          // other tenant's traffic. Per-tenant resolution is deliberate future work — when it lands
          // it takes a tenantId argument and prefers the tenant row over this one.
          isNull(pluginInstances.tenantId),
        ),
      )
      .orderBy(asc(pluginInstances.priority));

    for (const row of rows) {
      const factory =
        capability === "sms"
          ? smsAdapterFor(row.vendor)
          : capability === "email"
            ? emailAdapterFor(row.vendor)
            : paymentAdapterFor(row.vendor);
      if (!factory) {
        // Enabled in the control plane, but this build has no adapter. Skip rather than throw: a
        // catalog row for a vendor we cannot dispatch must not block a working fallback.
        this.logger.warn(
          `plugin instance ${row.id} enabled for vendor '${row.vendor}' with no adapter in this build`,
        );
        continue;
      }
      const credential = await this.credentialsFor(row.id, row.credentialsRef);
      if (!credential) continue;
      const { creds, version } = credential;
      // The cast is safe by construction: the factory was chosen from the capability-matching
      // registry three lines up, so an sms capability yields an SmsSenderPlugin and a payment
      // capability a PaymentProviderPlugin. The public resolveSms/resolvePayment wrappers are what
      // callers see, and each narrows back to its own type.
      return {
        vendor: row.vendor,
        instanceId: row.id,
        provider: factory(),
        creds,
        credentialVersion: version,
      } as ResolvedProvider | ResolvedEmailProvider | ResolvedPaymentProvider;
    }
    return null;
  }

  /** Decrypt the active credential for an instance, or null when unusable. */
  private async credentialsFor(
    instanceId: string,
    credentialsRef: string | null,
  ): Promise<{ creds: Creds; version: number } | null> {
    if (!credentialsRef) {
      this.logger.warn(`plugin instance ${instanceId} has no credentials`);
      return null;
    }
    const masterKey = derivePluginMasterKey(this.config, this.logger);

    const [row] = await this.provisioning.db
      .select()
      .from(pluginCredentials)
      .where(eq(pluginCredentials.id, credentialsRef))
      .limit(1);
    // A NULL dek_wrapped is a REVOKED credential — the secret is permanently unreadable by design,
    // so this is a normal state to skip, not an error to retry.
    if (!row?.dekWrapped) {
      this.logger.warn(
        `plugin instance ${instanceId} credential ${credentialsRef} is missing or revoked`,
      );
      return null;
    }
    try {
      const dek = unwrapCredentialDek(
        masterKey,
        row.dekWrapped,
        instanceId,
        row.version,
      );
      // The version travels with the secret so a caller can record WHICH credential it used — a
      // payment intent stores it, which is what lets its webhook still verify after a rotation.
      return {
        creds: decryptCredential(dek, row.ciphertext, instanceId, row.version),
        version: row.version,
      };
    } catch (error) {
      // Wrong master key, tampering, or a version mismatch. Never fall through to another
      // credential — an unreadable secret is a configuration fault that must stay visible.
      this.logger.error(
        `plugin instance ${instanceId} credential could not be decrypted: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      return null;
    }
  }
}

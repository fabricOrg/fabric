import {
  decryptCredential,
  type ProvisioningDb,
  pluginCredentials,
  pluginInstances,
  unwrapCredentialDek,
} from "@app/db";
import type { Creds, PaymentProviderPlugin } from "@app/integrations";
import { paymentAdapterFor } from "@app/integrations";
import type { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { derivePluginMasterKey } from "./plugin-master-key.js";

export interface PaymentWebhookCredential {
  readonly mode: "sandbox" | "live";
  readonly instanceId: string;
  readonly version: number;
  readonly provider: PaymentProviderPlugin;
  readonly creds: Creds;
}

/** How many credential versions per instance may verify a webhook. */
const VERSIONS_PER_INSTANCE = 2;

/**
 * Every credential a PAYMENT webhook could legitimately be signed with — each enabled instance's
 * current key PLUS its immediately previous version.
 *
 * The previous version is not laxity: rotation is not atomic with the outside world. Charges created
 * under the old key are still in flight when a new one is installed, and their webhooks would
 * otherwise become permanently unverifiable — the payment would strand, already taken from the
 * customer. Bounded at two so this can never become an unbounded trial loop.
 *
 * Trying multiple keys is safe because they are all ours: an attacker still has to produce a valid
 * HMAC under one of them. What this must NOT do is let the caller skip checking WHICH key matched —
 * `payments.provider_mode` binds each intent to its mode precisely so a test-key webhook cannot
 * settle a live charge.
 *
 * Deliberately NOT cached: it is reached only on webhook delivery, and a REVOKED key (NULL
 * dek_wrapped) must stop verifying immediately rather than at the end of a TTL.
 */
export async function paymentWebhookCredentials(
  provisioning: ProvisioningDb,
  config: ConfigService,
  logger: Logger,
): Promise<PaymentWebhookCredential[]> {
  const out: PaymentWebhookCredential[] = [];
  const masterKey = derivePluginMasterKey(config, logger);

  for (const mode of ["sandbox", "live"] as const) {
    const rows = await provisioning.db
      .select({ id: pluginInstances.id, vendor: pluginInstances.vendor })
      .from(pluginInstances)
      .where(
        and(
          eq(pluginInstances.capability, "payment"),
          eq(pluginInstances.mode, mode),
          eq(pluginInstances.enabled, true),
          isNull(pluginInstances.tenantId),
        ),
      )
      .orderBy(asc(pluginInstances.priority));

    for (const row of rows) {
      const factory = paymentAdapterFor(row.vendor);
      if (!factory) continue;
      const versions = await provisioning.db
        .select({
          version: pluginCredentials.version,
          dekWrapped: pluginCredentials.dekWrapped,
          ciphertext: pluginCredentials.ciphertext,
        })
        .from(pluginCredentials)
        .where(eq(pluginCredentials.pluginInstanceId, row.id))
        .orderBy(desc(pluginCredentials.version))
        .limit(VERSIONS_PER_INSTANCE);

      for (const version of versions) {
        // A NULL dek_wrapped is REVOKED — it must never verify anything again.
        if (!version.dekWrapped) continue;
        try {
          const dek = unwrapCredentialDek(
            masterKey,
            version.dekWrapped,
            row.id,
            version.version,
          );
          out.push({
            mode,
            instanceId: row.id,
            version: version.version,
            provider: factory(),
            creds: decryptCredential(
              dek,
              version.ciphertext,
              row.id,
              version.version,
            ),
          });
        } catch {
          // Unreadable under the current master key — skip rather than fail the whole webhook.
        }
      }
    }
  }
  return out;
}

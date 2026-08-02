import { type ProvisioningDb, pluginInstances } from "@app/db";
import { isNotNull } from "drizzle-orm";

/**
 * Refuse to run a spec that TRUNCATES the plugin catalog when that catalog holds real configuration.
 *
 * `plugin_instances` is platform-wide with no tenant column, and two specs delete the whole table to
 * get a clean catalog — reasonable on an ephemeral CI database, and destructive on a developer's, where
 * the same table holds whatever an operator armed. On 2026-08-02 a full `test:integration` run deleted
 * a configured live Arkesel instance and its encrypted credential; the registry then re-seeded a blank
 * catalog, so the loss was silent and unrecoverable — the credential ciphertext was the only copy.
 *
 * A configured credential is the signal, because it is the thing a test never creates and never needs:
 * catalog rows are re-seeded on demand, but `credentials_ref` means a human installed a secret here.
 * Failing loudly turns "your live integration is gone" into "point this at a scratch database".
 */
export async function assertDisposablePluginCatalog(
  db: ProvisioningDb,
): Promise<void> {
  const configured = await db.db
    .select({
      vendor: pluginInstances.vendor,
      capability: pluginInstances.capability,
      mode: pluginInstances.mode,
    })
    .from(pluginInstances)
    .where(isNotNull(pluginInstances.credentialsRef));
  if (configured.length === 0) return;
  const named = configured
    .map((row) => `${row.capability}/${row.vendor} (${row.mode})`)
    .join(",   ");
  throw new Error(
    `refusing to wipe the plugin catalog: this database holds installed credentials — ${named}. ` +
      "This spec deletes every plugin_instances row, which would destroy that configuration " +
      "irrecoverably (the credential ciphertext is the only copy). Point DATABASE_URL_SUPER at a " +
      "scratch database, or revoke those credentials first if they are genuinely disposable.",
  );
}

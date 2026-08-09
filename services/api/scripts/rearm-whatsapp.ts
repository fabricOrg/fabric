/**
 * Re-arm the platform's live Meta WhatsApp credential from the injected environment.
 *
 * WHY THIS EXISTS: `plugin_instances` has no tenant column and two integration specs delete the whole
 * table. Their `beforeAll` guard (assertDisposablePluginCatalog) refuses when the catalog holds
 * installed credentials, but their TEARDOWN delete was unguarded until now, so a full-suite run
 * destroyed the configured meta-cloud instances. The credential ciphertext is the only copy, so
 * recovery means re-installing from source-of-truth — Infisical.
 *
 * Run it under Infisical so the values arrive as env vars and never touch the shell history or a file:
 *
 *   infisical run --env=dev -- pnpm --filter @app/api exec tsx scripts/rearm-whatsapp.ts
 *
 * It prints a FINGERPRINT and never a value. Idempotent: `createLiveInstance` returns the existing row
 * and `configure` rotates to a new version rather than mutating in place.
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module.js";
import { PluginCredentialsService } from "../src/plugins/plugin-credentials.service.js";
import { PluginRegistryService } from "../src/plugins/plugin-registry.service.js";

const REQUIRED = [
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_WABA_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
] as const;

const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
  console.error(`missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ["error", "warn"],
});
const registry = app.get(PluginRegistryService);
const credentials = app.get(PluginCredentialsService);

// Seeds the catalog if this database has never listed it, which is what creates the sandbox sibling.
await registry.list();

const live = await registry.createLiveInstance({
  vendor: "meta-cloud",
  capability: "whatsapp",
  label: "Meta Cloud API (live)",
});

const result = await credentials.configure(
  live.id,
  {
    credential: {
      phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
      waba_id: process.env.WHATSAPP_WABA_ID ?? "",
      access_token: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
      app_secret: process.env.WHATSAPP_APP_SECRET ?? "",
      webhook_verify_token: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "",
    },
  },
  { email: "ops@fabric.dev", staffId: null },
);

// Enable, then activate-live. Two acts on purpose (ADR-0011 §5): activation refuses without installed
// credentials, so it must follow configure — `enabled + live + no key` is an outage dressed as config.
await registry.apply(live.id, "enable");
await registry.apply(live.id, "activate-live");
await registry.apply(live.id, "make-default");

const armed = (await registry.list()).filter(
  (i) => i.capability === "whatsapp",
);
console.log(
  `configured: version=${result.version} fingerprint=${result.fingerprint}`,
);
for (const instance of armed) {
  console.log(
    `${instance.vendor} | ${instance.mode} | enabled=${instance.enabled} | default=${instance.isDefault} | status=${instance.status}`,
  );
}
await app.close();
process.exit(0);

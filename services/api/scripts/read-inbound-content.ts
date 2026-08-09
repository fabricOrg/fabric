/**
 * Read the newest inbound WhatsApp message back out of the PII vault, to prove the round trip:
 * ingestion encrypted it under the tenant's DEK and the same key opens it again.
 *
 * Prints a TRUNCATED prefix only. The point is that decryption succeeds and the plaintext is nowhere
 * but the vault — not to reproduce a customer's message into a terminal log.
 *
 *   infisical run --env=dev -- pnpm --filter @app/api exec tsx scripts/read-inbound-content.ts
 */
import "reflect-metadata";
import { createProvisioningDb } from "@app/db";
import { NestFactory } from "@nestjs/core";
import { sql } from "drizzle-orm";
import { AppModule } from "../src/app.module.js";
import { PiiVaultService } from "../src/privacy/pii-vault.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
if (!superUrl) {
  console.error("DATABASE_URL_SUPER required");
  process.exit(1);
}
const provisioning = createProvisioningDb(superUrl, { max: 1 });
type Row = Record<string, unknown>;
const [row] = (await provisioning.db.execute(sql`
  SELECT tenant_id, content_pii_id, message_type, provider_ref
  FROM whatsapp_inbound_messages
  ORDER BY received_at DESC LIMIT 1`)) as Row[];
await provisioning.end();
if (!row?.content_pii_id) {
  console.error("no inbound message with stored content");
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ["error"],
});
const vault = app.get(PiiVaultService);
const raw = await vault.read(String(row.tenant_id), String(row.content_pii_id));
if (!raw) {
  console.error("vault read returned nothing — the DEK did not open the row");
  await app.close();
  process.exit(1);
}
const parsed = JSON.parse(raw) as {
  from?: string;
  type?: string;
  text?: { body?: string };
};
const body = parsed.text?.body ?? "";
console.log(`decrypted ok: type=${parsed.type} bytes=${raw.length}`);
console.log(`from suffix: …${(parsed.from ?? "").slice(-4)}`);
console.log(
  `body prefix: ${JSON.stringify(body.slice(0, 24))}${body.length > 24 ? "…" : ""}`,
);
await app.close();
process.exit(0);

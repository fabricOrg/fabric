/**
 * Drive one LIVE WhatsApp send through the running API over HTTP, so the whole stack is exercised
 * (auth → kill switches → compliance → pricing → wallet reserve → worker → Meta) rather than just the
 * service method.
 *
 * It mints a short-lived live API key scoped to `whatsapp:send`, uses it in-process, and REVOKES it
 * before exiting — the raw key is never printed and never persisted anywhere but the hash column. The
 * `finally` block is the point: a crash mid-send must not leave a usable live credential behind.
 *
 *   infisical run --env=dev -- pnpm --filter @app/api exec tsx scripts/live-whatsapp-send.ts +233...
 */
import { randomUUID } from "node:crypto";
import { createProvisioningDb } from "@app/db";
import { sql } from "drizzle-orm";
import { hashApiKey } from "../src/api-keys/api-key.crypto.js";

const to = process.argv[2];
const templateName = process.argv[3] ?? "hello_world";
const templateLanguage = process.argv[4] ?? "en_US";
if (!to?.startsWith("+")) {
  console.error("usage: live-whatsapp-send.ts +233XXXXXXXXX [template] [lang]");
  process.exit(1);
}

const superUrl = process.env.DATABASE_URL_SUPER;
if (!superUrl) {
  console.error("DATABASE_URL_SUPER required");
  process.exit(1);
}
const db = createProvisioningDb(superUrl, { max: 2 });

type Row = Record<string, unknown>;
const [target] = (await db.db.execute(sql`
  SELECT a.id AS tenant_id, a.name, app.id AS application_id, e.id AS environment_id
  FROM accounts a
  JOIN applications app ON app.tenant_id = a.id
  JOIN environments e ON e.application_id = app.id AND e.type = 'live'
  WHERE a.name = 'Fabric Live Pilot'
  LIMIT 1`)) as Row[];
if (!target) {
  console.error("no live environment found for 'Fabric Live Pilot'");
  await db.end();
  process.exit(1);
}

const raw = `sk_live_${randomUUID().replace(/-/g, "")}${"7".repeat(8)}`;
const prefix = raw.slice(0, 13);
await db.db.execute(sql`
  INSERT INTO api_keys (
    tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
  ) VALUES (
    ${String(target.tenant_id)}, ${String(target.application_id)},
    ${String(target.environment_id)}, ${prefix}, ${hashApiKey(raw)}, 'live',
    '["whatsapp:send","whatsapp:read"]'::jsonb, 'active'
  )`);

try {
  const response = await fetch("http://localhost:3000/v1/whatsapp/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${raw}`,
      "content-type": "application/json",
      "idempotency-key": `live-inbound-probe-${randomUUID()}`,
    },
    body: JSON.stringify({
      to,
      template_name: templateName,
      template_language: templateLanguage,
      template_category: "utility",
      variables: [],
      currency: "GHS",
    }),
  });
  const body = await response.text();
  console.log(`HTTP ${response.status}`);
  console.log(body.slice(0, 800));

  // A send is proven by `provider_ref`, never by `status` — FakeProvider returns `accepted` exactly as
  // a carrier does (`fake-<id>` vs a real `wamid.`). Read it back from the row.
  // Unwrap the response envelope. Reading `.id` off the raw body left it undefined, so the
  // provider_ref read-back below was silently skipped and the script reported a "successful" live
  // send without ever proving one — against the rule it exists to enforce.
  const parsed = JSON.parse(body || "{}") as {
    data?: { id?: string };
    id?: string;
  };
  const id = parsed.data?.id ?? parsed.id;
  if (id) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const [row] = (await db.db.execute(sql`
        SELECT status::text, provider_ref, provider_slug, error_code,
               cost_minor::text AS cost, currency, backing
        FROM whatsapp_messages WHERE id = ${id}`)) as Row[];
      if (row?.provider_ref || row?.error_code) {
        console.log("row:", JSON.stringify(row));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
} finally {
  await db.db.execute(
    sql`UPDATE api_keys SET status = 'revoked' WHERE prefix = ${prefix}`,
  );
  console.log(`temporary key ${prefix}… revoked`);
  await db.end();
}

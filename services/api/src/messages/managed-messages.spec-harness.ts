// Shared seeding for managed-delivery integration specs: a tenant with one application, a released
// sandbox definition, a scoped messages:send/read API key, and a funded wallet.

import type { AppDb } from "@app/db";
import { credit } from "@app/wallet";
import type postgres from "postgres";
import { hashApiKey } from "../api-keys/api-key.crypto.js";
import { ApplicationsService } from "../applications/applications.service.js";
import type { AuditService } from "../audit/audit.service.js";
import { MessageDefinitionsService } from "../message-definitions/message-definitions.service.js";

export async function seedManagedTenant(input: {
  owner: postgres.Sql;
  db: AppDb;
  tenantId: string;
  rawKey: string;
}): Promise<{ applicationId: string; environmentId: string }> {
  const { owner, db, tenantId, rawKey } = input;
  await owner`
    INSERT INTO accounts (id, name, slug)
    VALUES (${tenantId}, 'Managed Sends', ${`managed-${tenantId}`})`;
  const apps = new ApplicationsService(db);
  const created = await apps.create(tenantId, {
    name: "Default",
    slug: "default",
  });
  const environmentId =
    created.environments.find((e) => e.type === "sandbox")?.id ?? "";
  const audit = { record: async () => undefined } as unknown as AuditService;
  const defs = new MessageDefinitionsService(db, audit);
  const definition = await defs.create(tenantId, {
    key: "order.shipped",
    application_id: created.id,
    variable_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer", minimum: 0 },
      },
      required: ["name"],
    },
    content: {
      body: "Hi {{name}}, {{count}} orders.",
      class: "transactional",
      locales: {},
    },
    default_locale: "en",
    sender_id: "FABRIC",
  });
  await defs.publish(
    tenantId,
    definition.definition.id,
    { environment: "sandbox", version_id: definition.latest_version?.id ?? "" },
    "key_test",
  );
  await owner`
    INSERT INTO api_keys (
      tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
    ) VALUES (
      ${tenantId}, ${created.id}, ${environmentId}, 'sk_test_manag',
      ${hashApiKey(rawKey)}, 'test', '["messages:send","messages:read"]'::jsonb, 'active'
    )`;
  await db.withTenant(tenantId, (tx) =>
    credit(tx, {
      currency: "GHS",
      amountMinor: 10_000n,
      idempotencyKey: `topup:managed-${tenantId}`,
    }),
  );
  return { applicationId: created.id, environmentId };
}

export async function cleanManagedTenant(
  owner: postgres.Sql,
  tenantId: string,
): Promise<void> {
  await owner`DELETE FROM outbox_events WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM message_delivery_attempts WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM message_deliveries WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM messages WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM message_definition_releases WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM message_definition_sender_bindings WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM message_definition_versions WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM message_definitions WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM api_keys WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM applications WHERE tenant_id = ${tenantId}`;
  await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
}

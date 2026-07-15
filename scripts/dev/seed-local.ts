import {
  accounts,
  apiKeys,
  createAppDb,
  smsTemplates,
  staffUsers,
  type TenantId,
} from "@app/db";
import { credit } from "@app/wallet";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { apiKeyScopeValues } from "../../packages/contracts/src/dev-portal.js";
import { hashApiKey } from "../../services/api/src/api-keys/api-key.crypto.js";

const tenantId =
  process.env.DEV_TENANT_ID ?? "00000000-0000-0000-0000-0000000000d1";
const rawKey = process.env.DASHBOARD_API_KEY;
const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const workosOrganizationId = process.env.WORKOS_ORGANIZATION_ID;
// First platform operator for the admin-console (comma-separated allowed). Falls back to the
// project owner's email so a fresh local/testing DB has exactly one admin who can sign in.
const staffEmails = (
  process.env.SEED_STAFF_EMAILS ?? "solomon.aboagye@amalitech.com"
)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter((email) => email.length > 0);

const localSmsTemplates = [
  {
    name: "Delivery update",
    body: "Hi {{name}}, your delivery {{reference}} is on the way and should arrive by {{eta}}.",
    messageClass: "transactional",
  },
  {
    name: "Payment receipt",
    body: "Hi {{name}}, we received your payment of {{amount}}. Reference: {{reference}}.",
    messageClass: "transactional",
  },
  {
    name: "Verification code",
    body: "Your Fabric verification code is {{code}}. It expires in {{minutes}} minutes. Do not share this code.",
    messageClass: "transactional",
  },
  {
    name: "Appointment reminder",
    body: "Hi {{name}}, this is a reminder for your appointment on {{date}} at {{time}}. Reply if you need help.",
    messageClass: "transactional",
  },
  {
    name: "Customer offer",
    body: "Hi {{name}}, enjoy {{offer}} until {{expiry}}. Terms apply. Reply STOP to opt out.",
    messageClass: "promotional",
  },
] as const;

if (!rawKey || !superUrl || !appUrl) {
  throw new Error(
    "DASHBOARD_API_KEY, DATABASE_URL_SUPER, and DATABASE_URL_APP are required.",
  );
}

async function main(): Promise<void> {
  const ownerPool = postgres(superUrl, { max: 1 });
  const owner = drizzle(ownerPool);
  const appDb = createAppDb(appUrl, { max: 1 });

  try {
    await owner
      .insert(accounts)
      .values({
        id: tenantId,
        name: "Fabric Local",
        slug: "fabric-local",
        ...(workosOrganizationId ? { workosOrganizationId } : {}),
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: {
          name: "Fabric Local",
          ...(workosOrganizationId ? { workosOrganizationId } : {}),
        },
      });
    await owner
      .insert(apiKeys)
      .values({
        tenantId,
        name: "Local dashboard BFF",
        prefix: rawKey.slice(0, 16),
        keyHash: hashApiKey(rawKey),
        env: "test",
        scopes: [...apiKeyScopeValues],
      })
      .onConflictDoUpdate({
        target: apiKeys.keyHash,
        set: {
          status: "active",
          scopes: [...apiKeyScopeValues],
        },
      });
    for (const email of staffEmails) {
      await owner
        .insert(staffUsers)
        .values({ email, name: "Fabric Operator", role: "admin" })
        .onConflictDoUpdate({
          target: staffUsers.email,
          set: { role: "admin", status: "active" },
        });
    }
    await appDb.withTenantDrizzle(tenantId, async (tx) => {
      for (const template of localSmsTemplates) {
        await tx
          .insert(smsTemplates)
          .values({
            tenantId: tenantId as TenantId,
            ...template,
          })
          .onConflictDoNothing({
            target: [smsTemplates.tenantId, smsTemplates.name],
          });
      }
    });
    await appDb.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 100_000n,
        idempotencyKey: "topup:local-development-seed",
        referenceId: tenantId,
      }),
    );
    console.log(`Local tenant ready: ${tenantId}`);
    console.log(`SMS templates ready: ${localSmsTemplates.length}`);
    console.log(`Staff seeded: ${staffEmails.join(", ")}`);
  } finally {
    await ownerPool.end();
    await appDb.end();
  }
}

void main();

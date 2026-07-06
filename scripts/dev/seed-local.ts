import { accounts, apiKeys, createAppDb, staffUsers } from "@app/db";
import { credit } from "@app/wallet";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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
        scopes: ["sms:send", "sms:read", "wallet:read"],
      })
      .onConflictDoUpdate({
        target: apiKeys.keyHash,
        set: {
          status: "active",
          scopes: ["sms:send", "sms:read", "wallet:read"],
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
    await appDb.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 100_000n,
        idempotencyKey: "topup:local-development-seed",
        referenceId: tenantId,
      }),
    );
    console.log(`Local tenant ready: ${tenantId}`);
    console.log(`Staff seeded: ${staffEmails.join(", ")}`);
  } finally {
    await ownerPool.end();
    await appDb.end();
  }
}

void main();

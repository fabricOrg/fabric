import {
  accounts,
  apiKeys,
  createAppDb,
  memberships,
  smsTemplates,
  staffUsers,
  type TenantId,
  users,
} from "@app/db";
import { credit } from "@app/wallet";
import { sql } from "drizzle-orm";
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
// The human who OWNS the local workspace, which is a different question from who operates the
// platform. Defaults to the first staff email so one person can use both surfaces locally: the
// dashboard forwards a staff user holding NO membership to the admin console
// (apps/dashboard/app/auth/callback/route.ts), so seeding staff WITHOUT this row makes customer
// sign-in impossible — it bounces to the console every time. Staff who also hold a membership fall
// through and use the dashboard normally, which is what this restores.
const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? staffEmails[0] ?? "")
  .trim()
  .toLowerCase();

/** Wallet money to seed, in minor units. Zero by default — see the credit call below for why. */
const seedWalletMinor = BigInt(process.env.SEED_WALLET_MINOR ?? "0");

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
        // Sandbox until go-live — matches self-serve provisioning (SANDBOX_PLAN). Without this the
        // schema default "free" makes the dashboard treat the workspace as live and hide every
        // sandbox key / log / webhook / email.
        plan: "sandbox",
        ...(workosOrganizationId ? { workosOrganizationId } : {}),
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: {
          name: "Fabric Local",
          plan: "sandbox",
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
    // A user is provisioned by EMAIL before first sign-in and `external_subject_id` is stamped then
    // (identity.ts:79). So this row is deliberately left unbound: user-session.service.ts looks up the
    // subject, falls back to email, and binds — but ONLY when the row it finds is still unbound.
    // Never set external_subject_id here; a wrong guess makes the real WorkOS subject unbindable.
    if (ownerEmail) {
      const [seededUser] = await owner
        .insert(users)
        .values({ email: ownerEmail, name: "Fabric Local Owner" })
        .onConflictDoUpdate({
          target: users.email,
          set: { status: "active" },
        })
        .returning({ id: users.id });
      if (seededUser) {
        await owner
          .insert(memberships)
          .values({
            tenantId: tenantId as TenantId,
            userId: seededUser.id,
            role: "owner",
            status: "active",
          })
          .onConflictDoUpdate({
            target: [memberships.tenantId, memberships.userId],
            set: { role: "owner", status: "active" },
          });
      }
    }
    // Give the local workspace the WABA's approved template catalog, which the hourly sync cannot do
    // for it: WhatsappTemplateSyncScheduler.tenantsForWaba only finds tenants that ALREADY hold a
    // template row or have already sent a non-sandbox message, so a workspace with neither never gets
    // a first sync and its compose picker stays empty forever. Copying is faithful rather than a
    // fixture — the WABA is shared across tenants in the aggregator model, so this is the same row the
    // sync would write once the tenant qualified. Needs 0150's tenant-scoped unique key to be legal.
    const copied = await owner.execute(sql`
      INSERT INTO whatsapp_templates (
        tenant_id, waba_id, name, language, category, status, quality_rating, components,
        synced_at, status_updated_at, quality_updated_at, category_updated_at
      )
      SELECT DISTINCT ON (waba_id, name, language)
        ${tenantId}, waba_id, name, language, category, status, quality_rating, components,
        synced_at, status_updated_at, quality_updated_at, category_updated_at
      FROM whatsapp_templates
      WHERE status = 'APPROVED' AND tenant_id <> ${tenantId}
      ORDER BY waba_id, name, language, synced_at DESC
      ON CONFLICT (tenant_id, waba_id, name, language) DO NOTHING
      RETURNING name`);
    // Counted separately from the RETURNING above, which reports only the rows this run INSERTED. A
    // re-run copies nothing because they are already there, and reporting that as "none available"
    // would describe a healthy seed as a broken one.
    const [templateTotal] = (await owner.execute(sql`
      SELECT count(*)::int AS count
      FROM whatsapp_templates
      WHERE tenant_id = ${tenantId} AND status = 'APPROVED'`)) as Array<{
      count: number;
    }>;
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
    // Opt-in, and OFF by default. A pre-funded wallet reads as real money in the dashboard, and it
    // hides which instrument a send actually drew on — tokens-first vs wallet-second is the whole
    // point of the prepaid path, and a seeded balance makes both look the same.
    if (seedWalletMinor > 0n) {
      await appDb.withTenant(tenantId, (tx) =>
        credit(tx, {
          currency: "GHS",
          amountMinor: seedWalletMinor,
          idempotencyKey: "topup:local-development-seed",
          referenceId: tenantId,
        }),
      );
    }
    console.log(`Local tenant ready: ${tenantId}`);
    console.log(
      seedWalletMinor > 0n
        ? `Wallet seeded: ${seedWalletMinor} minor`
        : "Wallet left EMPTY (set SEED_WALLET_MINOR to fund it)",
    );
    console.log(`SMS templates ready: ${localSmsTemplates.length}`);
    const approved = Number(templateTotal?.count ?? 0);
    console.log(
      approved > 0
        ? `WhatsApp templates ready: ${approved} approved (${copied.length} newly copied)`
        : "WhatsApp templates: none — nothing has synced this WABA's catalog yet",
    );
    console.log(`Staff seeded: ${staffEmails.join(", ")}`);
    console.log(
      ownerEmail
        ? `Workspace owner seeded: ${ownerEmail} (owner of fabric-local)`
        : "No workspace owner seeded — dashboard sign-in will bounce to the admin console",
    );
  } finally {
    await ownerPool.end();
    await appDb.end();
  }
}

void main();

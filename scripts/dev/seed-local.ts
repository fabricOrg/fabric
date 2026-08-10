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

/**
 * Refuse to run against anything but a local database.
 *
 * This script connects as the superuser and writes across tenant boundaries — it creates a
 * membership and copies template rows that belong to OTHER tenants, both of which bypass RLS. A
 * developer's `.env` carries every database URL, so pointing `DATABASE_URL_SUPER` at a cloud
 * environment for one migration check and then running the seed out of habit is a single command
 * away. This repo has already destroyed an armed live vendor credential exactly that way, so the
 * check is a host allowlist rather than a warning.
 */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
]);
const superHost = new URL(superUrl).hostname;
if (!LOCAL_HOSTS.has(superHost)) {
  throw new Error(
    `Refusing to seed: DATABASE_URL_SUPER points at '${superHost}', not a local database. This script writes across tenants as the superuser and is for local development only.`,
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
    // Give the local workspace an approved template catalog, which the hourly sync cannot do for it:
    // WhatsappTemplateSyncScheduler.tenantsForWaba only finds tenants that ALREADY hold a template row
    // or have already sent a non-sandbox message, so a workspace with neither never gets a first sync
    // and its compose picker stays empty forever. Legal only because of 0150's tenant-scoped key.
    //
    // Scoped to ONE waba — the most recently synced — because the table accumulates rows for more than
    // one over a database's life (an old credential, a spec fixture), and `listApprovedTemplates` does
    // NOT filter by waba, so a stray row would appear in the picker as a sendable template that this
    // workspace's credential cannot address.
    //
    // Honest about what it is: a SUBSET, not a replay of the sync. syncTenant writes every status; this
    // takes APPROVED only, so the paused/rejected branches of the send-time guard cannot be exercised
    // locally from seeded data. synced_at is copied rather than stamped `now()` — inheriting a stale
    // timestamp is the truth, and faking freshness would make the guard trust invented data.
    const copied = await owner.execute(sql`
      INSERT INTO whatsapp_templates (
        tenant_id, waba_id, name, language, category, status, quality_rating, components,
        synced_at, status_updated_at, quality_updated_at, category_updated_at
      )
      SELECT DISTINCT ON (name, language)
        ${tenantId}, waba_id, name, language, category, status, quality_rating, components,
        synced_at, status_updated_at, quality_updated_at, category_updated_at
      FROM whatsapp_templates
      WHERE status = 'APPROVED'
        AND tenant_id <> ${tenantId}
        AND waba_id = (
          SELECT waba_id FROM whatsapp_templates
          WHERE status = 'APPROVED' AND tenant_id <> ${tenantId}
          ORDER BY synced_at DESC, waba_id
          LIMIT 1
        )
      ORDER BY name, language, synced_at DESC
      ON CONFLICT (tenant_id, waba_id, name, language) DO NOTHING
      RETURNING name`);
    // Counted separately from the RETURNING above, which reports only the rows this run INSERTED. A
    // re-run copies nothing because they are already there, and reporting that as "none available"
    // would describe a healthy seed as a broken one.
    const [templateTotal] = (await owner.execute(sql`
      SELECT count(*)::int AS count,
             max(synced_at) > now() - interval '2 hours' AS fresh
      FROM whatsapp_templates
      WHERE tenant_id = ${tenantId} AND status = 'APPROVED'`)) as Array<{
      count: number;
      fresh: boolean | null;
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
    // Says "picker" rather than "ready", and reports staleness, because a copied row keeps the source's
    // synced_at: the catalog is almost always older than CACHE_MAX_AGE_MS on arrival, which shows the
    // templates in the compose picker while leaving the send-time guard fail-open. Calling that "ready"
    // would describe a half-working state as a working one.
    console.log(
      approved > 0
        ? `WhatsApp templates in the picker: ${approved} approved (${copied.length} newly copied)${
            templateTotal?.fresh
              ? ""
              : " — cache is STALE, so the send-time guard fails open"
          }`
        : "WhatsApp templates: none — no approved rows exist to copy from yet",
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

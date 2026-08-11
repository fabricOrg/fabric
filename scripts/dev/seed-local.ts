import {
  accounts,
  apiKeys,
  applications,
  createAppDb,
  type EnvironmentId,
  environments,
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
// Who OWNS the local workspace, which is a different question from who operates the platform. The
// dashboard forwards a staff user holding NO membership to the admin console
// (apps/dashboard/app/auth/callback/route.ts), so seeding staff WITHOUT a membership makes customer
// sign-in impossible — it bounces to the console every time. Staff who also hold a membership fall
// through and use the dashboard normally, which is what this restores.
//
// A LIST, like SEED_STAFF_EMAILS, and defaulting to every seeded staff email: a machine shared by
// more than one sign-in identity is the normal case here, and seeding only the first one reproduces
// the original bug for everybody else — silently, since the redirect looks identical to a config
// problem. Cheap to grant, and this is a local sandbox workspace.
const ownerEmails = (process.env.SEED_OWNER_EMAIL ?? staffEmails.join(","))
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter((email) => email.length > 0);

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

function assertLocal(url: string, label: string): void {
  // `postgres:` is a NON-SPECIAL URL scheme, so WHATWG parsing neither lowercases the host nor strips
  // the brackets from an IPv6 literal: `[::1]` arrives as "[::1]" and `LOCALHOST` stays uppercase.
  // Both would fail closed, which is safe but tells a developer on IPv6 or with a capitalised host
  // that a listed local host is "not a local database". Normalise so the allowlist means what it says.
  const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOSTS.has(host)) return;
  throw new Error(
    `Refusing to seed: ${label} points at '${host}', not a local database. This script writes across tenants as the superuser and is for local development only.`,
  );
}

// BOTH connections, not just the superuser one. The app connection writes sms_templates and, when
// SEED_WALLET_MINOR is set, a real double-entry ledger credit — so guarding only DATABASE_URL_SUPER
// left the docstring above claiming a protection the code did not deliver. The habit the guard exists
// to stop (repointing one URL at a cloud database for a quick check, then re-running the seed) applies
// to every URL in the file, and a developer .env carries all four.
assertLocal(superUrl, "DATABASE_URL_SUPER");
assertLocal(appUrl, "DATABASE_URL_APP");

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
          // `plan` is set on INSERT only, never on conflict. Forcing "sandbox" here silently REVERSED
          // a completed go-live — the plan is what the go-live maker-checker flow transitions, so a
          // re-seed would quietly undo an operator's deliberate approval and flip the workspace back
          // to forced-virtual sending. A seed may create state; it must not revoke a decision.
          ...(workosOrganizationId ? { workosOrganizationId } : {}),
        },
      });
    // ADR-0004's Workspace -> Application -> Environment hierarchy. The seed predated it, so the local
    // workspace had an account and API key but no application and no environments — and anything
    // scoped by environment fails closed on that. The WhatsApp message log is the visible one: it
    // resolves `applications JOIN environments WHERE type = ? AND status = 'active'` and throws
    // `whatsapp_environment_not_found` when the join is empty, which reads like a broken integration
    // rather than an unseeded workspace.
    const [application] = await owner
      .insert(applications)
      .values({
        tenantId: tenantId as TenantId,
        name: "Default",
        slug: "default",
      })
      .onConflictDoUpdate({
        target: [applications.tenantId, applications.slug],
        set: { name: "Default" },
      })
      .returning({ id: applications.id });
    if (!application) throw new Error("failed to seed the default application");

    // Sandbox is always usable. Unlocking LIVE demands positive evidence of a go-live, not merely a
    // plan that is not "sandbox" — because go-live's target value and the schema default are the SAME
    // string: proposals.service.ts sets `afterValue: "free"` and identity.ts declares
    // `plan ... .default("free")`. So `plan !== 'sandbox'` cannot distinguish "passed the compliance
    // gate" from "this row was never initialised" (a restored dump, a hand-written INSERT, a fixture
    // reusing DEV_TENANT_ID).
    //
    // Getting that wrong is a ONE-WAY DOOR, which is why it fails closed here. An active live
    // environment is what lets `sk_live_*` be minted (api-keys.service.ts: live keys require
    // `env.status === 'active'`), and delivery routing reads the environment's TYPE only —
    // `resolveModeForEnvironment` never re-checks status. So a key minted while the env was wrongly
    // active keeps reaching a real carrier even after a later run re-locks the environment.
    const [account] = (await owner.execute(sql`
      SELECT plan FROM accounts WHERE id = ${tenantId}`)) as Array<{
      plan: string;
    }>;
    const [approvedGoLive] = (await owner.execute(sql`
      SELECT 1 AS ok FROM proposals
      WHERE kind = 'go_live' AND tenant_id = ${tenantId} AND status = 'approved'
      LIMIT 1`)) as Array<{ ok: number }>;
    const liveStatus =
      account?.plan !== "sandbox" && approvedGoLive ? "active" : "locked";
    const environmentIds = new Map<"sandbox" | "live", EnvironmentId>();
    for (const type of ["sandbox", "live"] as const) {
      const [environment] = await owner
        .insert(environments)
        .values({
          tenantId: tenantId as TenantId,
          applicationId: application.id,
          type,
          status: type === "live" ? liveStatus : "active",
        })
        .onConflictDoUpdate({
          target: [environments.applicationId, environments.type],
          set: { status: type === "live" ? liveStatus : "active" },
        })
        .returning({ id: environments.id });
      // Throw rather than continue, matching the application above: silently skipping would leave the
      // API key unbound on a fresh database and stale-bound on a re-run, while the comment below
      // insists the binding matters.
      if (!environment)
        throw new Error(`failed to seed the ${type} environment`);
      environmentIds.set(type, environment.id);
    }

    // The BFF key is `env: "test"`, so it belongs to the SANDBOX environment. Binding it matters: the
    // schema note says "New keys always set both", and an unbound key cannot be scoped by environment
    // the way every real key is.
    const sandboxEnvironmentId = environmentIds.get("sandbox");
    // The conflict target is `keyHash`, which is globally unique and carries no tenant. So changing
    // DEV_TENANT_ID while keeping the same DASHBOARD_API_KEY now trips the application/tenant foreign
    // key and stops the seed. That crash is deliberate and better than the previous silence, which
    // left the key attached to the old tenant.
    await owner
      .insert(apiKeys)
      .values({
        tenantId,
        applicationId: application.id,
        ...(sandboxEnvironmentId
          ? { environmentId: sandboxEnvironmentId }
          : {}),
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
          applicationId: application.id,
          ...(sandboxEnvironmentId
            ? { environmentId: sandboxEnvironmentId }
            : {}),
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
    //
    // Known consequence, and why the host allowlist above is what contains it: the verified-email
    // precondition (`if (!byEmail && !request.email_verified) return null`) applies only when NO row
    // exists, so pre-provisioning one lets an UNVERIFIED identity with that address bind and inherit
    // this membership. That is the intended invite semantics, but a list widens it from one address to
    // every seeded staff email — acceptable on a local database, unacceptable anywhere else.
    for (const email of ownerEmails) {
      // `set` deliberately touches only `status`. An already-bound row keeps its external_subject_id,
      // so re-seeding never orphans an identity that has already signed in.
      const [seededUser] = await owner
        .insert(users)
        .values({ email, name: "Fabric Local Owner" })
        .onConflictDoUpdate({
          target: users.email,
          set: { status: "active" },
        })
        .returning({ id: users.id });
      if (!seededUser) continue;
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
          // `permissions` is cleared, not left alone. A non-null override IS the exact effective set
          // and the role becomes a template, so a membership carrying one would keep its narrowed
          // permissions while this script printed "Workspace owners seeded" — a claim the row does not
          // support. Clearing it costs a deliberately-narrowed local test its override on the next
          // re-seed, which is the lesser of the two surprises because it is visible immediately.
          set: { role: "owner", status: "active", permissions: null },
        });
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
      ownerEmails.length > 0
        ? `Workspace owners seeded on fabric-local: ${ownerEmails.join(", ")}`
        : "No workspace owner seeded — dashboard sign-in will bounce to the admin console",
    );
  } finally {
    await ownerPool.end();
    await appDb.end();
  }
}

void main();

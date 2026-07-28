import {
  type ApplicationId,
  accounts,
  apiKeys,
  applications,
  createAppDb,
  type EnvironmentId,
  environments,
  senders,
  type TenantId,
} from "@app/db";
import { credit } from "@app/wallet";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashApiKey } from "../../services/api/src/api-keys/api-key.crypto.js";

/**
 * LOCAL live-SMS pilot tenant. The normal `dev:seed` tenant is plan `sandbox`, and a sandbox
 * ENVIRONMENT is hard-pinned to the virtual phone (ADR-0004 routing) — it can never reach a
 * carrier, by design. Reaching a real carrier therefore needs a distinct tenant whose LIVE
 * environment is active, holding an `sk_live_` key and an `active` sender for the destination
 * country. This script builds exactly that and nothing else.
 *
 * It is a LOCAL development helper: it writes only to the database named by DATABASE_URL_SUPER.
 * It does not enable live delivery on its own — that still requires SMS_PROVIDER=arkesel,
 * ARKESEL_SANDBOX=false and a non-empty SMS_LIVE_RECIPIENT_ALLOWLIST in the API's environment,
 * each of which is a deliberate human-gated flip.
 */
const tenantId =
  process.env.LIVE_TENANT_ID ?? "00000000-0000-0000-0000-0000000000e1";
const rawKey = process.env.LIVE_API_KEY;
const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const senderId = (process.env.LIVE_SENDER_ID ?? "Fabric").trim();
const country = (process.env.LIVE_SENDER_COUNTRY ?? "GH").trim().toUpperCase();
/** GHS 200.00 in minor units — enough headroom that a reserve never fails mid-pilot. */
const seedMinor = 20_000n;

if (!rawKey || !superUrl || !appUrl) {
  throw new Error(
    "LIVE_API_KEY, DATABASE_URL_SUPER, and DATABASE_URL_APP are required.",
  );
}
if (!rawKey.startsWith("sk_live_")) {
  throw new Error("LIVE_API_KEY must begin with sk_live_ to route as live.");
}
if (senderId.length === 0 || senderId.length > 11) {
  throw new Error("LIVE_SENDER_ID must contain 1 to 11 characters.");
}

async function main(): Promise<void> {
  const ownerPool = postgres(superUrl as string, { max: 1 });
  const owner = drizzle(ownerPool);
  const appDb = createAppDb(appUrl as string, { max: 1 });

  try {
    // Plan is deliberately NOT `sandbox`: the plan-based fallback route (BFF token path, no
    // environment) reads it, and `sandbox` would pin every send to the virtual phone.
    await owner
      .insert(accounts)
      .values({
        id: tenantId,
        name: "Fabric Live Pilot",
        slug: "fabric-live-pilot",
        plan: "growth",
        status: "active",
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: { name: "Fabric Live Pilot", plan: "growth", status: "active" },
      });

    await owner
      .insert(applications)
      .values({
        tenantId: tenantId as TenantId,
        name: "Live pilot",
        slug: "live-pilot",
      })
      .onConflictDoNothing({
        target: [applications.tenantId, applications.slug],
      });
    const [application] = await owner
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.tenantId, tenantId as TenantId),
          eq(applications.slug, "live-pilot"),
        ),
      )
      .limit(1);
    if (!application) throw new Error("Live pilot application missing.");

    // Both environments exist so the tenant looks normal in the dashboard, but only the LIVE one
    // is active and carries the key — sandbox stays available for non-carrier experiments.
    for (const type of ["sandbox", "live"] as const) {
      await owner
        .insert(environments)
        .values({
          tenantId: tenantId as TenantId,
          applicationId: application.id,
          type,
          status: "active",
        })
        .onConflictDoUpdate({
          target: [environments.applicationId, environments.type],
          set: { status: "active" },
        });
    }
    const [liveEnv] = await owner
      .select({ id: environments.id })
      .from(environments)
      .where(
        and(
          eq(environments.applicationId, application.id),
          eq(environments.type, "live"),
        ),
      )
      .limit(1);
    if (!liveEnv) throw new Error("Live environment missing.");

    // The key carries the environment; routing reads it, not the plan (ADR-0004).
    await owner
      .insert(apiKeys)
      .values({
        tenantId: tenantId as TenantId,
        applicationId: application.id as ApplicationId,
        environmentId: liveEnv.id as EnvironmentId,
        name: "Local live pilot",
        prefix: rawKey.slice(0, 16),
        keyHash: hashApiKey(rawKey),
        env: "live",
        scopes: ["sms:send", "sms:read", "wallet:read"],
      })
      .onConflictDoUpdate({
        target: apiKeys.keyHash,
        set: {
          status: "active",
          applicationId: application.id as ApplicationId,
          environmentId: liveEnv.id as EnvironmentId,
          scopes: ["sms:send", "sms:read", "wallet:read"],
        },
      });

    // A live send fails closed unless the sender is `active` for the destination country. Approving
    // it here mirrors what the admin console's sender review would write — the carrier still has
    // its OWN approval, and an id Arkesel hasn't approved is rejected at the provider.
    await owner
      .insert(senders)
      .values({
        tenantId: tenantId as TenantId,
        senderId,
        country,
        type: "alphanumeric",
        useCase: "Local live-delivery pilot (transactional).",
        status: "active",
        decidedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [senders.tenantId, senders.senderId, senders.country],
        set: { status: "active", decidedAt: new Date() },
      });

    await appDb.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: seedMinor,
        idempotencyKey: `topup:live-pilot-seed:${tenantId}`,
        referenceId: tenantId,
      }),
    );

    console.log(`Live pilot tenant ready:  ${tenantId}`);
    console.log(`Live environment:         ${liveEnv.id}`);
    console.log(`Key prefix:               ${rawKey.slice(0, 12)}…`);
    console.log(`Sender approved locally:  ${senderId} (${country})`);
    console.log(`Wallet credited:          GHS ${Number(seedMinor) / 100}`);
  } finally {
    await ownerPool.end();
    await appDb.end();
  }
}

void main();

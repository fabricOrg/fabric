// ============================================================================================
// ADR-0002 F2 — self-serve sandbox provisioning against a real migrated DB. WorkOS is FAKED
// (an in-memory org/membership store mirroring the tenant-provisioning spec's approach); the
// DB writes, idempotency, and gates are real. tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import {
  accounts,
  applications,
  createAppDb,
  createProvisioningDb,
  environments,
  memberships,
  users,
} from "@app/db";
import type { WorkOS } from "@workos-inc/node";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { IdentityService } from "./identity.service.js";
import {
  SANDBOX_PLAN,
  SelfServeProvisioningService,
} from "./self-serve-provisioning.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

/** In-memory WorkOS fake: real org ids, deletions tracked (compensation assertions). */
function fakeWorkos() {
  const orgs = new Map<string, { name: string }>();
  const orgMemberships: Array<{ organizationId: string; userId: string }> = [];
  const deleted: string[] = [];
  const client = {
    organizations: {
      createOrganization: async ({ name }: { name: string }) => {
        const id = `org_${randomUUID()}`;
        orgs.set(id, { name });
        return { id, name };
      },
      deleteOrganization: async (id: string) => {
        orgs.delete(id);
        deleted.push(id);
      },
    },
    userManagement: {
      createOrganizationMembership: async (options: {
        organizationId: string;
        userId: string;
        roleSlug?: string;
      }) => {
        orgMemberships.push(options);
        return { id: `om_${randomUUID()}`, ...options };
      },
    },
  } as unknown as WorkOS;
  return { client, orgs, orgMemberships, deleted };
}

function killSwitchWith(signupOn: boolean): KillSwitchService {
  return {
    signupEnabled: async () => signupOn,
  } as unknown as KillSwitchService;
}

describeDb("self-serve sandbox provisioning (ADR-0002)", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 1 });
  const audit = { record: async () => undefined } as unknown as AuditService;
  const workos = fakeWorkos();
  const service = new SelfServeProvisioningService(
    db,
    appDb,
    () => workos.client,
    audit,
    killSwitchWith(true),
  );
  const identity = new IdentityService(db);

  const sub = `user_${randomUUID()}`;
  const email = `stranger-${randomUUID()}@example.com`;
  const createdTenantIds: string[] = [];

  const strangerRequest = {
    external_user_id: sub,
    email,
    name: "Ama Stranger",
    user_updated_at: "2026-07-10T10:00:00.000Z",
    email_verified: true,
    allow_provision: true,
  };

  afterAll(async () => {
    const rows = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    const userIds = rows.map((r) => r.id);
    if (userIds.length > 0) {
      await db.db
        .delete(memberships)
        .where(inArray(memberships.userId, userIds));
      await db.db.delete(users).where(inArray(users.id, userIds));
    }
    if (createdTenantIds.length > 0) {
      for (const table of [
        "ledger_entries",
        "ledger_transactions",
        "ledger_accounts",
      ]) {
        for (const tenantId of createdTenantIds) {
          await db.db.execute(
            sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${tenantId}'`),
          );
        }
      }
      await db.db
        .delete(accounts)
        .where(inArray(accounts.id, createdTenantIds as never[]));
    }
    await appDb.end();
    await db.end();
  });

  it("provisions a sandbox tenant for a verified stranger — org, account, bound user, owner membership", async () => {
    const result = await service.organizationForUser(strangerRequest);
    expect(result).not.toBeNull();
    expect(result?.provisioned).toBe(true);
    if (!result) throw new Error("unreachable");
    createdTenantIds.push(result.tenant_id);

    const [account] = await db.db
      .select({
        plan: accounts.plan,
        status: accounts.status,
        workosOrganizationId: accounts.workosOrganizationId,
      })
      .from(accounts)
      .where(eq(accounts.id, result.tenant_id as never));
    expect(account).toMatchObject({
      plan: SANDBOX_PLAN,
      status: "active",
      workosOrganizationId: result.workos_organization_id,
    });

    const [user] = await db.db
      .select({
        id: users.id,
        externalSubjectId: users.externalSubjectId,
        status: users.status,
      })
      .from(users)
      .where(eq(users.email, email));
    expect(user?.externalSubjectId).toBe(sub);
    expect(user?.status).toBe("active");

    const rows = await db.db
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.tenantId, result.tenant_id as never));
    expect(rows).toEqual([{ role: "owner", status: "active" }]);

    // ADR-0004: the workspace was born with a default application + a sandbox env (active) and a
    // live env (LOCKED until go-live). This is the forward path the backfill mirrors for old tenants.
    const [app] = await db.db
      .select({ id: applications.id, slug: applications.slug })
      .from(applications)
      .where(eq(applications.tenantId, result.tenant_id as never));
    expect(app?.slug).toBe("default");
    const envs = await db.db
      .select({ type: environments.type, status: environments.status })
      .from(environments)
      .where(eq(environments.tenantId, result.tenant_id as never));
    expect(envs).toEqual(
      expect.arrayContaining([
        { type: "sandbox", status: "active" },
        { type: "live", status: "locked" },
      ]),
    );
    expect(envs).toHaveLength(2);

    // WorkOS side: the user was attached to the fresh org as admin.
    expect(workos.orgMemberships).toContainEqual(
      expect.objectContaining({
        organizationId: result.workos_organization_id,
        userId: sub,
      }),
    );
    // F3: the sandbox wallet was seeded with ledgered test credits (balanced by trigger).
    const bal = await db.db.execute(
      sql.raw(
        `SELECT balance_minor::text AS b FROM ledger_accounts WHERE tenant_id = '${result.tenant_id}' AND kind = 'customer' AND currency = 'GHS'`,
      ),
    );
    expect((bal as unknown as Array<{ b: string }>)[0]?.b).toBe("5000");

    // The provisioned identity now resolves a normal session (returning-login path).
    await expect(
      identity.resolve({
        external_user_id: sub,
        organization_id: result.workos_organization_id,
        email,
        name: "Ama Stranger",
        user_updated_at: "2026-07-10T10:05:00.000Z",
        role: "member",
        permissions: [],
        session_id: "session_signup",
      }),
    ).resolves.toMatchObject({ tenant_id: result.tenant_id, role: "owner" });
  });

  it("is idempotent: the same identity resolves its EXISTING org — no second tenant", async () => {
    const again = await service.organizationForUser(strangerRequest);
    expect(again?.provisioned).toBe(false);
    expect(again?.tenant_id).toBe(createdTenantIds[0]);
    expect(workos.orgs.size).toBe(1); // still exactly one org for this identity
  });

  it("denies an unverified email and an allow_provision:false caller (no rows created)", async () => {
    const freshSub = `user_${randomUUID()}`;
    const freshEmail = `unverified-${randomUUID()}@example.com`;
    await expect(
      service.organizationForUser({
        ...strangerRequest,
        external_user_id: freshSub,
        email: freshEmail,
        email_verified: false,
      }),
    ).resolves.toBeNull();
    await expect(
      service.organizationForUser({
        ...strangerRequest,
        external_user_id: freshSub,
        email: freshEmail,
        allow_provision: false,
      }),
    ).resolves.toBeNull();
    const rows = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, freshEmail));
    expect(rows).toHaveLength(0);
  });

  it("fails closed when the platform.signup kill-switch is off — but still resolves existing users", async () => {
    const disabled = new SelfServeProvisioningService(
      db,
      appDb,
      () => workos.client,
      audit,
      killSwitchWith(false),
    );
    // Stranger: denied.
    await expect(
      disabled.organizationForUser({
        ...strangerRequest,
        external_user_id: `user_${randomUUID()}`,
        email: `off-${randomUUID()}@example.com`,
      }),
    ).resolves.toBeNull();
    // Known identity: still resolved (the flag gates PROVISIONING, not lookup).
    await expect(
      disabled.organizationForUser(strangerRequest),
    ).resolves.toMatchObject({
      provisioned: false,
      tenant_id: createdTenantIds[0],
    });
  });

  it("returns an invited (unbound) user's org so the invite flow keeps working unpinned", async () => {
    const invitedEmail = `invited-${randomUUID()}@example.com`;
    const tenantOrg = `org_${randomUUID()}`;
    const [account] = await db.db
      .insert(accounts)
      .values({
        name: "Invited Co",
        slug: `invited-${randomUUID()}`,
        workosOrganizationId: tenantOrg,
        status: "active",
      })
      .returning({ id: accounts.id });
    if (!account) throw new Error("seed account failed");
    createdTenantIds.push(account.id);
    const [invited] = await db.db
      .insert(users)
      .values({ email: invitedEmail, status: "invited" })
      .returning({ id: users.id });
    if (!invited) throw new Error("seed user failed");
    await db.db.insert(memberships).values({
      tenantId: account.id,
      userId: invited.id,
      role: "member",
      status: "invited",
    });

    const result = await service.organizationForUser({
      external_user_id: `user_${randomUUID()}`, // first login: not bound yet
      email: invitedEmail,
      name: "Invited Member",
      user_updated_at: "2026-07-10T11:00:00.000Z",
      email_verified: true,
      allow_provision: true,
    });
    // Their EXISTING org comes back — no new tenant was provisioned for an invited email.
    expect(result).toMatchObject({
      workos_organization_id: tenantOrg,
      tenant_id: account.id,
      provisioned: false,
    });

    await db.db.delete(memberships).where(eq(memberships.userId, invited.id));
    await db.db.delete(users).where(eq(users.id, invited.id));
  });
});

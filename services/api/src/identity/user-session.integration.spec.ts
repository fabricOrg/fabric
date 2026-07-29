// ============================================================================================
// ADR-0007 slice 1 — resolve-v2 (user-level session) + local-only workspace creation against a
// real migrated DB. No WorkOS involvement at all: the point of the ADR is that neither path
// touches the IdP. tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import {
  accounts,
  applications,
  createProvisioningDb,
  environments,
  memberships,
  type TenantId,
  users,
} from "@app/db";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { SANDBOX_PLAN } from "./signup-shared.js";
import { UserSessionService } from "./user-session.service.js";
import { WorkspaceProvisioningService } from "./workspace-provisioning.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

function killSwitchWith(signupOn: boolean): KillSwitchService {
  return {
    signupEnabled: async () => signupOn,
  } as unknown as KillSwitchService;
}

describeDb("resolve-v2 + local workspace creation (ADR-0007)", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const audit = { record: async () => undefined } as unknown as AuditService;
  const sessions = new UserSessionService(db);
  const provisioning = new WorkspaceProvisioningService(
    db,
    audit,
    killSwitchWith(true),
  );

  const createdTenantIds: string[] = [];
  const createdUserEmails: string[] = [];

  afterAll(async () => {
    if (createdUserEmails.length > 0) {
      const rows = await db.db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.email, createdUserEmails));
      const ids = rows.map((row) => row.id);
      if (ids.length > 0) {
        await db.db.delete(memberships).where(inArray(memberships.userId, ids));
        await db.db.delete(users).where(inArray(users.id, ids));
      }
    }
    if (createdTenantIds.length > 0) {
      const tenants = createdTenantIds as TenantId[];
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
        .delete(environments)
        .where(inArray(environments.tenantId, tenants));
      await db.db
        .delete(applications)
        .where(inArray(applications.tenantId, tenants));
      await db.db
        .delete(memberships)
        .where(inArray(memberships.tenantId, tenants));
      await db.db.delete(accounts).where(inArray(accounts.id, tenants));
    }
    await db.end();
  });

  function claims(overrides: {
    external_user_id: string;
    email: string;
    email_verified?: boolean;
    name?: string | null;
  }) {
    return {
      external_user_id: overrides.external_user_id,
      email: overrides.email,
      name: overrides.name ?? "Test Person",
      user_updated_at: "2026-07-18T08:00:00.000Z",
      email_verified: overrides.email_verified ?? true,
      session_id: "session_test",
    };
  }

  it("creates a bare user (no workspace) for a verified stranger", async () => {
    const sub = `user_${randomUUID()}`;
    const email = `stranger-${randomUUID()}@example.com`;
    createdUserEmails.push(email);

    const resolved = await sessions.resolve(
      claims({ external_user_id: sub, email }),
    );
    expect(resolved).not.toBeNull();
    expect(resolved?.memberships).toEqual([]);

    const [user] = await db.db
      .select({
        externalSubjectId: users.externalSubjectId,
        status: users.status,
      })
      .from(users)
      .where(eq(users.email, email));
    expect(user).toMatchObject({ externalSubjectId: sub, status: "active" });
  });

  it("refuses an unverified stranger and creates nothing", async () => {
    const email = `unverified-${randomUUID()}@example.com`;
    const resolved = await sessions.resolve(
      claims({
        external_user_id: `user_${randomUUID()}`,
        email,
        email_verified: false,
      }),
    );
    expect(resolved).toBeNull();
    const rows = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });

  it("binds an invited email and activates every pending invite in active accounts", async () => {
    const sub = `user_${randomUUID()}`;
    const email = `invited-${randomUUID()}@example.com`;
    createdUserEmails.push(email);

    const [invitee] = await db.db
      .insert(users)
      .values({ email, status: "invited" })
      .returning({ id: users.id });
    if (!invitee) throw new Error("Seed user insert returned no row.");

    const mkTenant = async (name: string, status: "active" | "suspended") => {
      const [account] = await db.db
        .insert(accounts)
        .values({ name, slug: `adr7-${randomUUID()}`, status })
        .returning({ id: accounts.id });
      if (!account) throw new Error("Seed account insert returned no row.");
      createdTenantIds.push(account.id);
      return account.id;
    };
    const activeTenant = await mkTenant("Active Workspace", "active");
    const suspendedTenant = await mkTenant("Suspended Workspace", "suspended");
    await db.db.insert(memberships).values([
      {
        tenantId: activeTenant,
        userId: invitee.id,
        role: "admin",
        status: "invited",
      },
      {
        tenantId: suspendedTenant,
        userId: invitee.id,
        role: "member",
        status: "invited",
      },
    ]);

    const resolved = await sessions.resolve(
      claims({ external_user_id: sub, email }),
    );
    // Only the active account's membership is activated and listed; the suspended one stays
    // pending — signing in never widens access into a suspended workspace.
    expect(resolved?.memberships).toHaveLength(1);
    expect(resolved?.memberships[0]).toMatchObject({
      tenant_id: activeTenant,
      workspace_name: "Active Workspace",
      role: "admin",
      developer_access: false,
    });
    expect(resolved?.memberships[0]?.permissions).toContain("sms:send");

    const rows = await db.db
      .select({ tenantId: memberships.tenantId, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.userId, invitee.id));
    const byTenant = new Map(rows.map((row) => [row.tenantId, row.status]));
    expect(byTenant.get(activeTenant)).toBe("active");
    expect(byTenant.get(suspendedTenant)).toBe("invited");
  });

  it("refuses an email already bound to a different WorkOS subject", async () => {
    const email = `bound-${randomUUID()}@example.com`;
    createdUserEmails.push(email);
    await db.db.insert(users).values({
      email,
      externalSubjectId: `user_${randomUUID()}`,
      status: "active",
    });
    const resolved = await sessions.resolve(
      claims({ external_user_id: `user_${randomUUID()}`, email }),
    );
    expect(resolved).toBeNull();
  });

  it("creates a local-only workspace through onboarding, idempotent on double-submit", async () => {
    const sub = `user_${randomUUID()}`;
    const email = `founder-${randomUUID()}@example.com`;
    createdUserEmails.push(email);
    await sessions.resolve(claims({ external_user_id: sub, email }));

    const request = {
      external_user_id: sub,
      email,
      email_verified: true,
      workspace_name: "Kente Labs",
    };
    const created = await provisioning.createWorkspace(request);
    expect(created).toMatchObject({
      workspace_name: "Kente Labs",
      provisioned: true,
    });
    if (!created) throw new Error("workspace creation returned null");
    createdTenantIds.push(created.tenant_id);

    // Local-only: NO WorkOS organization id — the IdP is out of the creation path (ADR-0007).
    const [account] = await db.db
      .select({
        workosOrganizationId: accounts.workosOrganizationId,
        plan: accounts.plan,
      })
      .from(accounts)
      .where(eq(accounts.id, created.tenant_id as TenantId));
    expect(account).toMatchObject({
      workosOrganizationId: null,
      plan: SANDBOX_PLAN,
    });

    // Born with the ADR-0004 shape: default app, sandbox active, live locked.
    const envs = await db.db
      .select({ type: environments.type, status: environments.status })
      .from(environments)
      .where(eq(environments.tenantId, created.tenant_id as TenantId));
    expect(envs).toHaveLength(2);
    expect(envs).toEqual(
      expect.arrayContaining([
        { type: "sandbox", status: "active" },
        { type: "live", status: "locked" },
      ]),
    );

    // Sandbox onboarding creates no money: capacity comes from the daily operational allowance.
    const bal = await db.db.execute(
      sql.raw(
        `SELECT balance_minor::text AS b FROM ledger_accounts WHERE tenant_id = '${created.tenant_id}' AND kind = 'customer' AND currency = 'GHS'`,
      ),
    );
    expect((bal as unknown as Array<{ b: string }>)[0]?.b).toBeUndefined();

    // Replay with the same name returns the SAME workspace, creates nothing.
    const replay = await provisioning.createWorkspace(request);
    expect(replay).toMatchObject({
      tenant_id: created.tenant_id,
      provisioned: false,
    });

    // resolve-v2 now lists the new workspace with the owner baseline.
    const resolved = await sessions.resolve(
      claims({ external_user_id: sub, email }),
    );
    expect(resolved?.memberships).toHaveLength(1);
    expect(resolved?.memberships[0]).toMatchObject({
      tenant_id: created.tenant_id,
      role: "owner",
    });
  });

  it("refuses workspace creation for an unknown subject or unverified email", async () => {
    expect(
      await provisioning.createWorkspace({
        external_user_id: `user_${randomUUID()}`,
        email: `ghost-${randomUUID()}@example.com`,
        email_verified: true,
        workspace_name: "Ghost Workspace",
      }),
    ).toBeNull();

    const sub = `user_${randomUUID()}`;
    const email = `halfway-${randomUUID()}@example.com`;
    createdUserEmails.push(email);
    await sessions.resolve(claims({ external_user_id: sub, email }));
    expect(
      await provisioning.createWorkspace({
        external_user_id: sub,
        email,
        email_verified: false,
        workspace_name: "Halfway Workspace",
      }),
    ).toBeNull();
  });

  it("fails closed when the signup kill-switch is off", async () => {
    const gated = new WorkspaceProvisioningService(
      db,
      audit,
      killSwitchWith(false),
    );
    const sub = `user_${randomUUID()}`;
    const email = `gated-${randomUUID()}@example.com`;
    createdUserEmails.push(email);
    await sessions.resolve(claims({ external_user_id: sub, email }));
    expect(
      await gated.createWorkspace({
        external_user_id: sub,
        email,
        email_verified: true,
        workspace_name: "Gated Workspace",
      }),
    ).toBeNull();
  });
});

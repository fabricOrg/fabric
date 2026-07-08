import { randomUUID } from "node:crypto";
import { createProvisioningDb, staffUsers } from "@app/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { StaffService } from "./staff.service.js";
import type { WorkosClientProvider } from "./workos-client.provider.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

// Records the org-less WorkOS invitations invite() attempts — no network. The invitation is
// best-effort, so a throw here would be swallowed; we assert it's CALLED, not that it succeeds.
const invited: string[] = [];
const workosClient = (() => ({
  userManagement: {
    sendInvitation: async ({ email }: { email: string }) => {
      invited.push(email);
      return {};
    },
  },
})) as unknown as WorkosClientProvider;

// Lifecycle is exercised on an OPERATOR so the last-active-admin guard never fires — that guard
// depends on the global admin count, which differs between a seeded local DB and a fresh CI DB, so
// it isn't asserted here (it's a simple count check, covered by review).
describeDb("staff management", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new StaffService(db, workosClient);
  const email = `operator-${randomUUID()}@example.com`;

  async function idFor(target: string): Promise<string> {
    const [row] = await db.db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(eq(staffUsers.email, target))
      .limit(1);
    if (!row) throw new Error("staff row missing");
    return row.id;
  }

  afterAll(async () => {
    await db.db.delete(staffUsers).where(eq(staffUsers.email, email));
    await db.end();
  });

  it("allowlists a staff member (unbound until first sign-in)", async () => {
    const staff = await service.invite({
      email: email.toUpperCase(), // lowercased at the write boundary
      name: "Ops One",
      role: "operator",
    });
    expect(staff).toMatchObject({
      email,
      name: "Ops One",
      role: "operator",
      status: "active",
      bound: false,
    });
    // Net-new staff get an org-less WorkOS onboarding invitation (best-effort).
    expect(invited).toContain(email);
  });

  it("lists the staff member", async () => {
    const { staff } = await service.list();
    expect(staff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email, role: "operator", status: "active" }),
      ]),
    );
  });

  it("suspends then reactivates", async () => {
    const id = await idFor(email);
    expect(await service.update(id, { status: "suspended" })).toMatchObject({
      status: "suspended",
    });
    expect(await service.update(id, { status: "active" })).toMatchObject({
      status: "active",
    });
  });

  it("returns null when updating a staff member that doesn't exist", async () => {
    expect(await service.update(randomUUID(), { role: "admin" })).toBeNull();
  });

  it("removes the staff member", async () => {
    const id = await idFor(email);
    expect(await service.remove(id)).toBe(true);
    const { staff } = await service.list();
    expect(staff.find((s) => s.email === email)).toBeUndefined();
    expect(await service.remove(id)).toBe(false); // already gone
  });
});

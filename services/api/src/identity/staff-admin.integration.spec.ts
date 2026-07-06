import { randomUUID } from "node:crypto";
import { createProvisioningDb, staffUsers } from "@app/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { IdentityService } from "./identity.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("staff management", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new IdentityService(db);
  const email = `operator-${randomUUID()}@example.com`;

  afterAll(async () => {
    await db.db.delete(staffUsers).where(eq(staffUsers.email, email));
    await db.end();
  });

  it("allowlists a staff member (unbound until first sign-in)", async () => {
    const staff = await service.inviteStaff({
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
  });

  it("lists the staff member", async () => {
    const { staff } = await service.listStaff();
    expect(staff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email, role: "operator", status: "active" }),
      ]),
    );
  });

  it("re-inviting upgrades the role and reactivates", async () => {
    await db.db
      .update(staffUsers)
      .set({ status: "suspended" })
      .where(eq(staffUsers.email, email));

    const staff = await service.inviteStaff({ email, role: "admin" });
    expect(staff).toMatchObject({ role: "admin", status: "active" });
  });
});

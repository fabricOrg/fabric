import { createProvisioningDb, staffUsers } from "@app/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityService } from "./identity.service.js";

// Runs only when a real DB is configured (local docker / CI ephemeral); skipped otherwise.
const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

const CLAIMS = {
  external_user_id: "user_staff_test",
  email: "Operator.Test@Fabric.dev", // mixed case on purpose — resolver lowercases
  name: "Operator Test",
  user_updated_at: "2026-07-06T00:00:00.000Z",
  session_id: "sess_staff_test",
} as const;

describeDb("staff identity resolve", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new IdentityService(db);

  // staff_users is GLOBAL platform config (no tenant) — the test owns its own rows.
  beforeAll(async () => {
    await db.db
      .delete(staffUsers)
      .where(eq(staffUsers.email, "operator.test@fabric.dev"));
    await db.db
      .delete(staffUsers)
      .where(eq(staffUsers.email, "suspended.test@fabric.dev"));
    await db.db.insert(staffUsers).values([
      { email: "operator.test@fabric.dev", role: "admin", status: "active" },
      {
        email: "suspended.test@fabric.dev",
        role: "operator",
        status: "suspended",
      },
    ]);
  });
  afterAll(async () => {
    await db.db
      .delete(staffUsers)
      .where(eq(staffUsers.email, "operator.test@fabric.dev"));
    await db.db
      .delete(staffUsers)
      .where(eq(staffUsers.email, "suspended.test@fabric.dev"));
    await db.end();
  });

  it("resolves an active staff member (case-insensitive) with role permissions", async () => {
    const resolved = await service.resolveStaff(CLAIMS);
    expect(resolved).not.toBeNull();
    expect(resolved?.role).toBe("admin");
    expect(resolved?.permissions).toContain("staff:write");
    expect(resolved?.session_id).toBe(CLAIMS.session_id);
  });

  it("stamps external_subject_id + last_seen_at on resolve", async () => {
    await service.resolveStaff(CLAIMS);
    const [row] = await db.db
      .select({
        ext: staffUsers.externalSubjectId,
        seen: staffUsers.lastSeenAt,
      })
      .from(staffUsers)
      .where(eq(staffUsers.email, "operator.test@fabric.dev"));
    expect(row?.ext).toBe(CLAIMS.external_user_id);
    expect(row?.seen).not.toBeNull();
  });

  it("refuses a suspended staff member", async () => {
    const resolved = await service.resolveStaff({
      ...CLAIMS,
      email: "suspended.test@fabric.dev",
    });
    expect(resolved).toBeNull();
  });

  it("refuses an email that isn't on the staff table", async () => {
    const resolved = await service.resolveStaff({
      ...CLAIMS,
      email: "stranger@fabric.dev",
    });
    expect(resolved).toBeNull();
  });
});

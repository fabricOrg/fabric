import { randomUUID } from "node:crypto";
import { auditEvents, createProvisioningDb } from "@app/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AuditService } from "./audit.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("audit log", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new AuditService(db);
  const targetId = randomUUID();

  afterAll(async () => {
    await db.db.delete(auditEvents).where(eq(auditEvents.targetId, targetId));
    await db.end();
  });

  it("records an event and lists it back", async () => {
    await service.record({
      actorEmail: "ops@fabric.dev",
      action: "kill_switch.toggle",
      targetType: "kill_switch",
      targetId,
      summary: "Paused SMS sending",
      reason: "Spam investigation",
      metadata: { before: true, after: false },
    });

    const { events } = await service.list();
    const found = events.find((e) => e.target_id === targetId);
    expect(found).toMatchObject({
      actor_email: "ops@fabric.dev",
      action: "kill_switch.toggle",
      target_type: "kill_switch",
      summary: "Paused SMS sending",
      reason: "Spam investigation",
    });
    expect(found?.metadata).toEqual({ before: true, after: false });
    expect(typeof found?.created_at).toBe("string");
  });
});

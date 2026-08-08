import { auditEvents, createProvisioningDb, killSwitches } from "@app/db";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import { KillSwitchService } from "./kill-switches.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

const KEY = "platform.sms_sending";

describeDb("kill switches", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new KillSwitchService(db, new AuditService(db));

  afterAll(async () => {
    // Reset the shared catalog row + drop the audit rows this test created.
    await db.db
      .update(killSwitches)
      .set({ enabled: true, lastReason: null, lastActorEmail: null })
      .where(eq(killSwitches.key, KEY));
    await db.db
      .delete(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "kill_switch.toggle"),
          eq(auditEvents.targetId, KEY),
        ),
      );
    await db.end();
  });

  it("seeds the catalog and lists switches", async () => {
    const { switches } = await service.list();
    expect(switches.find((s) => s.key === KEY)).toMatchObject({
      enabled: true,
      scope: "platform",
    });
  });

  it("pauses (toggle off), records audit, and reports isPaused", async () => {
    const updated = await service.toggle(
      KEY,
      { enabled: false, reason: "Spam incident #4830" },
      { email: "ops@fabric.dev", staffId: null },
    );
    expect(updated).toMatchObject({
      enabled: false,
      last_reason: "Spam incident #4830",
      last_actor_email: "ops@fabric.dev",
    });
    expect(await service.isPaused(KEY)).toBe(true);

    const [event] = await db.db
      .select({
        action: auditEvents.action,
        summary: auditEvents.summary,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "kill_switch.toggle"),
          eq(auditEvents.targetId, KEY),
        ),
      );
    // `tenantId: null` says which switch was flipped — the platform breaker, not an override.
    expect(event?.metadata).toEqual({
      before: true,
      after: false,
      tenantId: null,
    });
  });

  it("returns null for an unknown switch", async () => {
    expect(
      await service.toggle(
        "does.not.exist",
        { enabled: false, reason: "whatever reason" },
        { email: null, staffId: null },
      ),
    ).toBeNull();
  });
});

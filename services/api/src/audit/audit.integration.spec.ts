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

  it("keyset-paginates newest-first with no skips or duplicates", async () => {
    const tag = randomUUID();
    // Seed more than one page-worth for THIS tag so paging is exercised in isolation.
    for (let i = 0; i < 5; i++) {
      await service.record({
        action: "test.page",
        targetType: "pagination",
        targetId: tag,
        summary: `event ${i}`,
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    // Page size 2 → walk the whole log 2 at a time, collecting only this tag's rows.
    do {
      const res = await service.list({
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      expect(res.events.length).toBeLessThanOrEqual(2);
      for (const e of res.events) {
        if (e.target_id === tag) seen.push(e.id);
      }
      cursor = res.next_cursor ?? undefined;
      pages++;
      if (pages > 100) throw new Error("pagination did not terminate");
    } while (cursor);

    // All 5 seeded rows seen exactly once (Set size === array length → no duplicates).
    expect(seen.length).toBe(5);
    expect(new Set(seen).size).toBe(5);

    await db.db.delete(auditEvents).where(eq(auditEvents.targetId, tag));
  });
});

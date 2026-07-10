import { randomUUID } from "node:crypto";
import {
  accounts,
  auditEvents,
  createProvisioningDb,
  proposals,
} from "@app/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import { ProposalService } from "./proposals.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("maker-checker proposals", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new ProposalService(db, new AuditService(db));
  const makerId = randomUUID();
  const checkerId = randomUUID();
  let proposalId = "";

  afterAll(async () => {
    if (proposalId) {
      await db.db
        .delete(auditEvents)
        .where(eq(auditEvents.targetId, proposalId));
      await db.db.delete(proposals).where(eq(proposals.id, proposalId));
    }
    await db.end();
  });

  it("creates a pending proposal (maker)", async () => {
    const created = await service.create(
      {
        kind: "wallet_adjustment",
        tenant_label: "KwikGH",
        before_value: "GHS 100",
        after_value: "GHS 150",
        reason: "Goodwill credit — outage 07-02",
      },
      { email: "maker@fabric.dev", staffId: makerId },
    );
    proposalId = created.id;
    expect(created).toMatchObject({
      status: "pending",
      maker_email: "maker@fabric.dev",
      kind: "wallet_adjustment",
    });
  });

  it("refuses the maker deciding their own proposal (separation of duties)", async () => {
    await expect(
      service.decide(
        proposalId,
        { decision: "approve" },
        { email: "maker@fabric.dev", staffId: makerId },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "separation_of_duties" } },
    });
  });

  it("lets a different admin approve, and records audit", async () => {
    const decided = await service.decide(
      proposalId,
      { decision: "approve", reason: "Verified with support" },
      { email: "checker@fabric.dev", staffId: checkerId },
    );
    expect(decided).toMatchObject({
      status: "approved",
      checker_email: "checker@fabric.dev",
    });

    const events = await db.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.targetId, proposalId));
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["proposal.create", "proposal.approved"]),
    );
  });

  it("refuses deciding an already-decided proposal", async () => {
    await expect(
      service.decide(
        proposalId,
        { decision: "reject" },
        { email: "checker@fabric.dev", staffId: checkerId },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "already_decided" } },
    });
  });

  it("returns null for an unknown proposal", async () => {
    expect(
      await service.decide(
        randomUUID(),
        { decision: "approve" },
        { email: "checker@fabric.dev", staffId: checkerId },
      ),
    ).toBeNull();
  });

  it("lists proposals", async () => {
    const { proposals: rows } = await service.list();
    expect(rows.some((p) => p.id === proposalId)).toBe(true);
  });
});

describeDb(
  "go-live requests (ADR-0002 F4 — the first EXECUTING proposal kind)",
  () => {
    const db = createProvisioningDb(superUrl ?? "", { max: 1 });
    const service = new ProposalService(db, new AuditService(db));
    const tenantId = randomUUID();
    const checkerId = randomUUID();

    afterAll(async () => {
      await db.db.delete(auditEvents).where(eq(auditEvents.targetId, tenantId));
      const rows = await db.db
        .select({ id: proposals.id })
        .from(proposals)
        .where(eq(proposals.tenantId, tenantId as never));
      for (const row of rows) {
        await db.db.delete(auditEvents).where(eq(auditEvents.targetId, row.id));
      }
      await db.db
        .delete(proposals)
        .where(eq(proposals.tenantId, tenantId as never));
      await db.db.delete(accounts).where(eq(accounts.id, tenantId as never));
      await db.end();
    });

    it("customer request → pending proposal; duplicates blocked; status readable", async () => {
      await db.db.insert(accounts).values({
        id: tenantId as never,
        name: "Sandbox Co",
        slug: `sandbox-co-${tenantId.slice(0, 8)}`,
        plan: "sandbox",
        status: "active",
      });
      const created = await service.requestGoLive(
        tenantId,
        {
          business_name: "Sandbox Co Ltd",
          registration_number: "CS0001",
          use_case: "OTP + transactional notifications for our checkout.",
        },
        "owner@sandbox.co",
      );
      expect(created).toMatchObject({
        kind: "go_live",
        status: "pending",
        before_value: "sandbox",
        after_value: "free",
        maker_email: "owner@sandbox.co",
      });
      await expect(
        service.requestGoLive(
          tenantId,
          { business_name: "Sandbox Co Ltd", use_case: "duplicate attempt…" },
          "owner@sandbox.co",
        ),
      ).rejects.toMatchObject({
        response: { error: { code: "go_live_already_requested" } },
      });
      await expect(service.goLiveStatus(tenantId)).resolves.toMatchObject({
        status: "pending",
      });
    });

    it("staff approval EXECUTES: plan flips sandbox → free; re-request refused as not_sandbox", async () => {
      const [pending] = await db.db
        .select({ id: proposals.id })
        .from(proposals)
        .where(eq(proposals.tenantId, tenantId as never));
      if (!pending) throw new Error("pending go-live proposal missing");
      const decided = await service.decide(
        pending.id,
        { decision: "approve", reason: "Docs check out." },
        { email: "checker@fabric.dev", staffId: checkerId },
      );
      expect(decided?.status).toBe("approved");
      const [account] = await db.db
        .select({ plan: accounts.plan })
        .from(accounts)
        .where(eq(accounts.id, tenantId as never));
      expect(account?.plan).toBe("free");
      await expect(
        service.requestGoLive(
          tenantId,
          { business_name: "Sandbox Co Ltd", use_case: "we are live already…" },
          "owner@sandbox.co",
        ),
      ).rejects.toMatchObject({
        response: { error: { code: "not_sandbox" } },
      });
      await expect(service.goLiveStatus(tenantId)).resolves.toMatchObject({
        status: "approved",
      });
    });
  },
);

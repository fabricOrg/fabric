import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type TenantId,
} from "@app/db";
import { commit, credit, refund, reserve } from "@app/wallet";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * SDK-007 ledger-reason rename — BACKWARD-COMPATIBILITY proof. reserve()/commit()/refund() now write
 * the channel-neutral message_* reasons, and reservedFor() matches BOTH message_reserve and the legacy
 * sms_reserve. A reservation placed BEFORE the rename (reason = sms_reserve) must therefore still
 * commit and refund. Simulated by placing a real reserve, then backdating its ledger reason to the
 * legacy value, then resolving it through the shipped service.
 */

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP ?? superUrl;
const describeDb = superUrl ? describe : describe.skip;

describeDb(
  "legacy sms_reserve reservations still settle after the rename",
  () => {
    const provisioning = createProvisioningDb(superUrl ?? "", { max: 2 });
    const appDb = createAppDb(appUrl ?? "");
    const owner = postgres(superUrl ?? "", { max: 1 });

    const tenantId = randomUUID() as TenantId;
    const CREDIT = 100_000n;
    const AMOUNT = 250n;

    beforeAll(async () => {
      await provisioning.db.insert(accounts).values({
        id: tenantId,
        name: "Legacy Reserve Compat",
        slug: `legacy-${tenantId}`,
      });
      await appDb.withTenant(tenantId, (tx) =>
        credit(tx, {
          currency: "GHS",
          amountMinor: CREDIT,
          idempotencyKey: `topup:legacy-${tenantId}`,
        }),
      );
    });

    afterAll(async () => {
      await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
      await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
    });

    /** Reserve for real, then rewrite the reason to the pre-rename value to forge a legacy reservation. */
    async function placeLegacyReservation(referenceId: string): Promise<void> {
      await appDb.withTenant(tenantId, (tx) =>
        reserve(tx, {
          currency: "GHS",
          amountMinor: AMOUNT,
          idempotencyKey: `reserve:${referenceId}`,
          referenceId,
        }),
      );
      const updated = await owner`
      UPDATE ledger_entries SET reason = 'sms_reserve'
      WHERE tenant_id = ${tenantId} AND reference_id = ${referenceId}
        AND reason = 'message_reserve'`;
      // Both legs of the reserve movement carry the reason — backdate all of them.
      expect(updated.count).toBeGreaterThan(0);
    }

    async function customerBalance(): Promise<bigint> {
      const rows = await owner`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'`;
      return BigInt(String(rows[0]?.balance_minor ?? "0"));
    }

    async function reasonCount(
      referenceId: string,
      reason: string,
    ): Promise<number> {
      const rows = await owner`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE tenant_id = ${tenantId} AND reference_id = ${referenceId}
        AND reason = ${reason}`;
      return Number(rows[0]?.n);
    }

    it("commits a legacy sms_reserve reservation (revenue recognised)", async () => {
      const referenceId = randomUUID();
      await placeLegacyReservation(referenceId);

      // reservedFor() must find the sms_reserve leg or commit throws NoReservationError.
      await appDb.withTenant(tenantId, (tx) =>
        commit(tx, { referenceId, idempotencyKey: `commit:${referenceId}` }),
      );

      // The commit leg is written with the new reason; the reservation resolved from the legacy one.
      expect(await reasonCount(referenceId, "message_commit")).toBeGreaterThan(
        0,
      );
    });

    it("refunds a legacy sms_reserve reservation (balance restored)", async () => {
      const referenceId = randomUUID();
      await placeLegacyReservation(referenceId);
      const afterReserve = await customerBalance();

      await appDb.withTenant(tenantId, (tx) =>
        refund(tx, { referenceId, idempotencyKey: `refund:${referenceId}` }),
      );

      expect(await reasonCount(referenceId, "message_refund")).toBeGreaterThan(
        0,
      );
      // The parked funds are returned to the customer balance.
      expect(await customerBalance()).toBe(afterReserve + AMOUNT);
    });
  },
);

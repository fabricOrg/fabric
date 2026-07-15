import type { ProvisioningDb } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { QueueService } from "../queue/queue.service.js";
import type { EmailService } from "./email.service.js";
import { EmailSendWorker } from "./email-send.worker.js";

describe("Email dispatch recovery trigger", () => {
  it("discovers pending tenants and invokes durable re-enqueue", async () => {
    let query = 0;
    const transaction = async (
      run: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>,
    ) =>
      run({
        execute: async () => {
          query++;
          return query === 1 ? [{ locked: true }] : [{ tenant_id: "tenant-1" }];
        },
      });
    const enqueuePending = vi.fn(async () => 2);
    const worker = new EmailSendWorker(
      { enabled: true } as QueueService,
      { enqueuePending } as unknown as EmailService,
      { db: { transaction } } as unknown as ProvisioningDb,
      { get: () => undefined } as unknown as ConfigService,
    );

    await worker.recoveryTick();

    expect(enqueuePending).toHaveBeenCalledWith("tenant-1");
  });

  it("does not recover while the durable queue is disabled", async () => {
    const transaction = vi.fn();
    const worker = new EmailSendWorker(
      { enabled: false } as QueueService,
      {} as EmailService,
      { db: { transaction } } as unknown as ProvisioningDb,
      { get: () => undefined } as unknown as ConfigService,
    );

    await worker.recoveryTick();

    expect(transaction).not.toHaveBeenCalled();
  });
});

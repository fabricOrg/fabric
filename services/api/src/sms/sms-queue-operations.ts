import type { DeliveryMode } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { PreparedSend, SendInput, SendResult } from "@app/sms-engine";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import type { QueueService } from "../queue/queue.service.js";
import {
  completeStoredDispatch,
  loadStoredDispatch,
  pendingDispatches,
} from "./sms-dispatch-store.js";
import { SMS_SEND_QUEUE, type SmsSendJob } from "./sms-send.job.js";

export async function enqueueSmsJob(
  queue: QueueService,
  job: { tenantId: string; messageId: string; deliveryMode: DeliveryMode },
): Promise<void> {
  await queue.queue(SMS_SEND_QUEUE).add("send", job satisfies SmsSendJob, {
    jobId: job.messageId,
    attempts: 5,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { count: 1_000 },
    removeOnFail: true,
  });
}

/** Best-effort recovery enqueue: a queue outage defers to the next maintenance tick, never throws. */
export async function recoverPendingSmsSafely(input: {
  db: AppDb;
  queue: QueueService;
  tenantId: string;
  warn: (message: string) => void;
}): Promise<number> {
  if (!input.queue.enabled) return 0;
  try {
    return await recoverPendingSms(input);
  } catch (error) {
    input.warn(
      `sms-send recovery enqueue deferred for ${input.tenantId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return 0;
  }
}

export async function recoverPendingSms(input: {
  db: AppDb;
  queue: QueueService;
  tenantId: string;
}): Promise<number> {
  const pending = await pendingDispatches(input.db, input.tenantId);
  let enqueued = 0;
  for (const dispatch of pending) {
    await enqueueSmsJob(input.queue, {
      tenantId: input.tenantId,
      ...dispatch,
    });
    enqueued++;
  }
  return enqueued;
}

export async function processSmsJob(input: {
  db: AppDb;
  vault: PiiVaultService;
  job: SmsSendJob;
  dispatch: (
    value: SendInput,
    prepared: PreparedSend,
    mode: DeliveryMode,
  ) => Promise<SendResult>;
  fail: (
    value: SendInput,
    prepared: PreparedSend,
    mode: DeliveryMode,
  ) => Promise<SendResult>;
  legacyDispatch: (
    value: SendInput,
    prepared: PreparedSend,
  ) => Promise<SendResult>;
}): Promise<SendResult> {
  if ("input" in input.job) {
    const result =
      !input.job.deliveryMode && input.job.sandbox === true
        ? await input.legacyDispatch(input.job.input, input.job.prepared)
        : await input.dispatch(
            input.job.input,
            input.job.prepared,
            input.job.deliveryMode ?? "live",
          );
    await completeStoredDispatch(
      input.db,
      input.job.input.tenantId,
      input.job.prepared.messageId,
    );
    return result;
  }

  const stored = await loadStoredDispatch({
    db: input.db,
    vault: input.vault,
    tenantId: input.job.tenantId,
    messageId: input.job.messageId,
  });
  if (stored.kind === "skip") {
    await completeStoredDispatch(
      input.db,
      input.job.tenantId,
      input.job.messageId,
    );
    return { messageId: input.job.messageId, status: stored.status };
  }
  const result =
    stored.kind === "unreadable"
      ? await input.fail(stored.input, stored.prepared, stored.deliveryMode)
      : await input.dispatch(
          stored.input,
          stored.prepared,
          stored.deliveryMode,
        );
  await completeStoredDispatch(
    input.db,
    input.job.tenantId,
    input.job.messageId,
  );
  return result;
}

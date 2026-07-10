import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Job } from "bullmq";
import { QueueService } from "../queue/queue.service.js";
import { SMS_SEND_QUEUE, type SmsSendJob, SmsService } from "./sms.service.js";

/**
 * In-process consumer for the sms-send queue (finding 7 — modular monolith: the worker lives in
 * the same deployable, no new service). Registers only when the queue is enabled
 * (REDIS_QUEUE_URL); otherwise SmsService.send already ran inline and there is nothing to consume.
 *
 * Failure model: processQueuedSend throws → BullMQ retries with exponential backoff (5 attempts,
 * per-job opts set at enqueue). dispatchSend is retry-idempotent; a job that exhausts retries is
 * left to the TTL sweeper, which refunds the reservation.
 */
@Injectable()
export class SmsSendWorker implements OnModuleInit {
  private readonly logger = new Logger(SmsSendWorker.name);

  constructor(
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(SmsService) private readonly sms: SmsService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.queue.enabled) return;
    const raw = this.config.get<string>("SMS_SEND_CONCURRENCY");
    const parsed = raw ? Number(raw) : Number.NaN;
    const concurrency =
      Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
    this.queue.createWorker(
      SMS_SEND_QUEUE,
      async (job: Job<SmsSendJob>) => {
        const result = await this.sms.processQueuedSend(job.data);
        this.logger.log(
          `sms-send: message ${result.messageId} → ${result.status} (attempt ${job.attemptsMade + 1})`,
        );
        return result.status;
      },
      { concurrency },
    );
    this.logger.log(`sms-send worker up (concurrency=${concurrency})`);
  }
}

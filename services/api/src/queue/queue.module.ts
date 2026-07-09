import { Module } from "@nestjs/common";
import { QueueService } from "./queue.service.js";

/**
 * BullMQ infrastructure (finding 7). Infra ONLY — queues/workers belong to the feature modules
 * that import this (SmsModule owns the sms-send queue + its worker), which avoids the circular
 * import a "worker module" would create.
 */
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}

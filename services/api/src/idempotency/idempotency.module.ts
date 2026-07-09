import { Module } from "@nestjs/common";
import { IdempotencyService } from "./idempotency.service.js";

/**
 * Client Idempotency-Key support for money POSTs (finding 3). Deliberately its own module: the
 * SMS send uses it today; wallet top-ups and any future money POST import the same service —
 * one idempotency contract across the public API.
 */
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}

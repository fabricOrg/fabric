import { Module } from "@nestjs/common";
import { RateLimitService } from "./rate-limit.service.js";

/**
 * Token-bucket rate limiting for the public API (finding 6). ApiKeysModule imports this and
 * enforces inside ApiKeyGuard — every keyed endpoint is limited automatically, no per-controller
 * wiring to forget.
 */
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}

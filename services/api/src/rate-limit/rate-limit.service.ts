import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { tooManyRequests } from "../http/api-error.js";

/**
 * PER-KEY + PER-TENANT RATE LIMITING (ARCHITECTURE §9, remediation finding 6) — TOKEN BUCKET in
 * Redis, atomic via a Lua script (refill + take must be one round trip; two INCR-style steps race
 * under concurrency). Each bucket holds `capacity` tokens and refills at `refillPerSec`; a request
 * takes one token; empty bucket → 429 `rate_limit_error`.
 *
 * Two buckets per request — the key's own AND the tenant's aggregate (one tenant can't dodge its
 * quota by minting many keys). Config stays in requests/minute: capacity = limit (a full minute of
 * burst headroom), refill = limit/60 per second (sustained rate). Tunables:
 * RATE_LIMIT_PER_KEY_PER_MINUTE (default 120), RATE_LIMIT_PER_TENANT_PER_MINUTE (default 600);
 * 0 disables that bucket.
 *
 * Availability posture (same as the kill-switch cache): limiting is a PROTECTION, not a promise —
 * Redis down/unset → requests pass, warn once per outage. The data plane never dies because the
 * limiter's store did. Uses the queue's Redis (REDIS_QUEUE_URL) under the `rl:` prefix; a
 * dedicated store is a later scaling decision.
 */

/**
 * KEYS[1] bucket key · ARGV: capacity, refillPerSec, nowMs.
 * Returns 1 (token taken) or 0 (empty → reject). State: HASH {tokens, ts}; TTL = 2× the full
 * refill horizon so idle buckets clean themselves up.
 */
const TAKE_TOKEN_LUA = `
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
tokens = math.min(capacity, tokens + (math.max(0, now - ts) / 1000) * refill)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', KEYS[1], math.ceil((capacity / refill) * 2))
return allowed
`;

/** ioredis client extended with the defineCommand-registered script. */
interface RateLimitRedis extends Redis {
  takeToken(
    key: string,
    capacity: number,
    refillPerSec: number,
    nowMs: number,
  ): Promise<number>;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redis: RateLimitRedis | null;
  private readonly perKeyLimit: number;
  private readonly perTenantLimit: number;
  private warnedUnavailable = false;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const url = config.get<string>("REDIS_QUEUE_URL");
    if (url) {
      // lazyConnect + one retry: an unreachable Redis must delay a request once, not hang it.
      const client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      // Swallow connection-level error events: consume() already handles failures per call
      // (fail-open); without a listener ioredis emits unhandled 'error' events on every retry.
      client.on("error", () => undefined);
      // ioredis 6 negotiates RESP3 by default — verified, not assumed: `CLIENT INFO` reports
      // resp=3 for this exact construction. It is safe because `replyMapping` still defaults to
      // "legacy", so replies keep their RESP2 shapes, and this script returns an integer either
      // way. Do NOT set `replyMapping: "resp3"` without re-reading every call site: it turns map
      // replies into objects and doubles into numbers.
      // defineCommand → EVALSHA with automatic script load; atomic on the server.
      client.defineCommand("takeToken", {
        numberOfKeys: 1,
        lua: TAKE_TOKEN_LUA,
      });
      this.redis = client as RateLimitRedis;
    } else {
      this.redis = null;
    }
    this.perKeyLimit = readLimit(config, "RATE_LIMIT_PER_KEY_PER_MINUTE", 120);
    this.perTenantLimit = readLimit(
      config,
      "RATE_LIMIT_PER_TENANT_PER_MINUTE",
      600,
    );
    this.logger.log(
      this.redis
        ? `rate limit: ON (token bucket — key=${this.perKeyLimit}/min, tenant=${this.perTenantLimit}/min)`
        : "rate limit: OFF — no REDIS_QUEUE_URL",
    );
  }

  /**
   * Take one token from both buckets; throws 429 when either is empty.
   * Fail-open on store errors — availability beats throttling.
   */
  async consume(keyId: string, tenantId: string): Promise<void> {
    if (!this.redis) return;
    const now = Date.now();

    // Taking tokens is the only fallible part — scope the try to it so our own 429s below can
    // never be mistaken for a store failure.
    let keyAllowed: number;
    let tenantAllowed: number;
    try {
      [keyAllowed, tenantAllowed] = await Promise.all([
        this.take(`rl:k:${keyId}`, this.perKeyLimit, now),
        this.take(`rl:t:${tenantId}`, this.perTenantLimit, now),
      ]);
      this.warnedUnavailable = false;
    } catch (error) {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true; // once per outage, not per request
        this.logger.warn(
          `rate-limit store unavailable — failing OPEN: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
      return;
    }

    if (keyAllowed === 0) {
      throw tooManyRequests(
        "rate_limited",
        `API key rate limit exceeded (${this.perKeyLimit}/min sustained). Back off and retry.`,
      );
    }
    if (tenantAllowed === 0) {
      throw tooManyRequests(
        "tenant_rate_limited",
        `Tenant rate limit exceeded (${this.perTenantLimit}/min sustained). Back off and retry.`,
      );
    }
  }

  /** One token from `bucket`: capacity = limit, refill = limit/60 per second. 0-limit = disabled. */
  private async take(
    bucket: string,
    limit: number,
    nowMs: number,
  ): Promise<number> {
    if (limit <= 0 || !this.redis) return 1;
    return this.redis.takeToken(bucket, limit, limit / 60, nowMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }
}

function readLimit(
  config: ConfigService,
  name: string,
  fallback: number,
): number {
  const raw = config.get<string>(name);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

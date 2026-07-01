import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * API-key crypto (F2.3 / F8.2) — pure, no DB/Nest. Model (Stripe/Twilio): the key encodes its ENV in
 * the prefix (`sk_test_`/`sk_live_`) and is HASHED AT REST — we store SHA-256(raw), never the raw key
 * (shown once at creation, unrecoverable after). SHA-256 (not bcrypt) is correct here: an API key is
 * a 192-bit random secret, not a low-entropy password, so a fast hash is safe and lets us look up by
 * `key_hash` on an indexed equality. `prefix` (the leading chars) is stored + displayed to identify a
 * key in the dashboard without revealing it.
 */

export type ApiKeyEnv = "test" | "live";

const PREFIX: Record<ApiKeyEnv, string> = {
  test: "sk_test_",
  live: "sk_live_",
};

const SECRET_BYTES = 24; // 192 bits of entropy in the random tail
const DISPLAY_PREFIX_LEN = 12; // e.g. "sk_test_ab3d" — enough to identify, not to use

export interface GeneratedApiKey {
  /** The full secret. Returned to the caller ONCE at creation, then never stored or logged. */
  readonly raw: string;
  /** Leading chars (`sk_test_ab3d`) — stored + shown for identification; safe to persist/display. */
  readonly prefix: string;
  /** SHA-256(raw) hex — the ONLY representation persisted; what the guard looks up by. */
  readonly keyHash: string;
  readonly env: ApiKeyEnv;
}

/** Mint a new key: `sk_<env>_<base64url(24 random bytes)>`. Returns the raw (once) + what to store. */
export function generateApiKey(env: ApiKeyEnv): GeneratedApiKey {
  const raw = PREFIX[env] + randomBytes(SECRET_BYTES).toString("base64url");
  return {
    raw,
    prefix: raw.slice(0, DISPLAY_PREFIX_LEN),
    keyHash: hashApiKey(raw),
    env,
  };
}

/** SHA-256(raw) as hex — deterministic; the guard hashes the presented key and looks up by this. */
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Which environment a presented key claims (from its prefix), or null if it isn't a well-formed key. */
export function parseApiKeyEnv(raw: string): ApiKeyEnv | null {
  if (raw.startsWith(PREFIX.test)) return "test";
  if (raw.startsWith(PREFIX.live)) return "live";
  return null;
}

/**
 * Constant-time hash comparison — for the path where a candidate row is fetched by prefix and its
 * stored hash verified against the presented key's hash (avoids leaking match position via timing).
 * Lookup-by-`key_hash` equality doesn't strictly need it, but the resolver uses it as defense.
 */
export function safeHashEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

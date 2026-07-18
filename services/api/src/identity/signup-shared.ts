import { randomBytes } from "node:crypto";

// Signup/onboarding gates shared by workspace provisioning (ADR-0007 local-only path).

/** Sandbox tenants are a PLAN state, not a separate environment (ADR-0002 / F3). */
export const SANDBOX_PLAN = "sandbox";

/** F3: play money for the fake provider — GHS 50.00, enough for hundreds of test segments. */
export const SANDBOX_SEED_CURRENCY = "GHS";
export const SANDBOX_SEED_MINOR = 5_000n;

// Best-effort signup throttle: single-instance in-memory sliding window. Enough for the current
// one-task api service; move to the Redis rate-limit buckets when the api scales out.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_EMAIL = 5;
const MAX_GLOBAL = 100;
const attempts = new Map<string, number[]>();

export function throttled(email: string): boolean {
  const now = Date.now();
  for (const [key, hits] of attempts) {
    const alive = hits.filter((t) => now - t < WINDOW_MS);
    if (alive.length === 0) attempts.delete(key);
    else attempts.set(key, alive);
  }
  const emailHits = attempts.get(email) ?? [];
  const globalHits = [...attempts.values()].reduce((n, h) => n + h.length, 0);
  if (emailHits.length >= MAX_PER_EMAIL || globalHits >= MAX_GLOBAL) {
    return true;
  }
  attempts.set(email, [...emailHits, now]);
  return false;
}

export function deriveSlug(seed: string): string {
  const local = (seed.split("@")[0] ?? "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `${local || "workspace"}-${randomBytes(4).toString("hex")}`;
}

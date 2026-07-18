import "server-only";

import { headers } from "next/headers";

/**
 * ADR-0008: abuse control for the Fabric-owned credential routes. Hosted AuthKit shipped WorkOS
 * Radar for free; the raw APIs don't, so login-surface throttling is ours. Per-IP + per-email
 * sliding windows. FAILS CLOSED — a login endpoint that can't rate-limit refuses (this is a
 * security check, not the data plane's fail-open availability posture).
 *
 * In-process, single-instance (same shape as the API's self-serve throttle). Multi-instance
 * hardening = a shared Redis bucket; wire it when the dashboard scales past one task.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 30;
const MAX_PER_EMAIL = 8;
const hits = new Map<string, number[]>();

function sweep(now: number): void {
  for (const [key, times] of hits) {
    const alive = times.filter((t) => now - t < WINDOW_MS);
    if (alive.length === 0) hits.delete(key);
    else hits.set(key, alive);
  }
}

function record(key: string, limit: number, now: number): boolean {
  const times = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= limit) return false;
  times.push(now);
  hits.set(key, times);
  return true;
}

/**
 * True when the attempt is allowed. Fails CLOSED: any fault (e.g. can't read headers) → denied.
 * Records an attempt for both the caller IP and the target email.
 */
export async function allowCredentialAttempt(email: string): Promise<boolean> {
  try {
    const store = await headers();
    // Trust the platform's forwarded client IP (Vercel sets x-forwarded-for / x-real-ip).
    const ip =
      store.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      store.get("x-real-ip") ||
      "unknown";
    const now = Date.now();
    sweep(now);
    const normalizedEmail = email.trim().toLowerCase();
    // Record both; deny if either bucket is full. Evaluate both so each attempt counts once.
    const ipOk = record(`ip:${ip}`, MAX_PER_IP, now);
    const emailOk = record(`email:${normalizedEmail}`, MAX_PER_EMAIL, now);
    return ipOk && emailOk;
  } catch {
    return false;
  }
}

import { timingSafeEqual } from "node:crypto";
import { WorkOS } from "@workos-inc/node";
import type { RealmConfig } from "./types.js";

/** Internal helpers shared by the org-scoped (v1) and user-level (ADR-0007) session paths. */

export function workos(cfg: RealmConfig): WorkOS {
  if (
    !cfg.apiKey ||
    !cfg.clientId ||
    !cfg.redirectUri ||
    !cfg.logoutRedirectUri ||
    cfg.cookiePassword.length < 32
  ) {
    throw new Error(`Invalid ${cfg.realm} WorkOS realm configuration.`);
  }
  return new WorkOS(cfg.apiKey, { clientId: cfg.clientId });
}

export function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

import type { ProvisioningDb } from "@app/db";
import type { Logger } from "@nestjs/common";
import {
  drainGlPostingRequests,
  type GlDrainResult,
} from "../accounting/gl-posting.worker.js";

/**
 * The maintenance tick for the GL posting airlock (ADR-0013 slice 1b): turn queued subledger movements
 * into corporate journals. Extracted from MaintenanceService so the service stays a thin scheduler.
 *
 * No advisory lock, unlike the other maintenance jobs — the drain claims each request
 * `FOR UPDATE SKIP LOCKED`, so concurrent runners are safe by construction rather than by serialising
 * the whole job behind one lock.
 *
 * KILL PATH: `GL_POSTING_ENABLED=false` stops the drain without a code change, and it is safe to leave
 * off for a while — the enqueue TRIGGER is unaffected, so nothing is lost; the queue simply grows and
 * drains when re-enabled. Posting is internal, append-only and idempotent, so the default is ON:
 * withholding it leaves the company's books incomplete, which is the worse failure.
 */
export async function runGlPostingDrain(input: {
  db: ProvisioningDb["db"];
  enabled: boolean;
  logger: Logger;
}): Promise<GlDrainResult | null> {
  if (!input.enabled) return null;

  const result = await drainGlPostingRequests(input.db);

  if (result.failed > 0) {
    input.logger.error(
      `GL POSTING: ${result.failed} request(s) parked as unpostable — inspect gl_posting_requests.last_error`,
    );
  }
  if (result.retrying > 0) {
    // Loud on purpose. A drain that keeps retrying leaves the books incomplete while every other
    // counter reads zero, so silence here would hide the problem indefinitely — the same failure mode
    // as a swallowed error, just spread over time.
    input.logger.error(
      `GL POSTING: ${result.retrying} request(s) failed transiently and will retry — last error: ${result.lastError ?? "unknown"}`,
    );
  }
  if (result.recovered > 0) {
    input.logger.warn(
      `GL POSTING: ${result.recovered} request(s) had already-posted journals; bookkeeping completed`,
    );
  }
  return result;
}

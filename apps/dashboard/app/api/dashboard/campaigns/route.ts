import { bffFailure } from "@/lib/server/bff-error";

/**
 * Campaign execution is not implemented yet. Fail explicitly instead of returning campaign-shaped
 * demo data: a caller must never mistake an in-memory acknowledgement for a persisted send.
 */
export async function GET() {
  return unavailable();
}

export async function POST() {
  return unavailable();
}

function unavailable() {
  return bffFailure(
    "campaigns_not_configured",
    "Campaigns are not available yet.",
    503,
  );
}

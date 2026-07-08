import { NextResponse } from "next/server";

/**
 * Liveness probe for the ECS container health check. Deliberately trivial — no SSR, no auth, no env,
 * no DB — so "is the Next server accepting requests" is decoupled from whether any page renders.
 * Public (outside the (app) route group, so no session guard). force-dynamic so it's never
 * statically optimized into a cached response.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}

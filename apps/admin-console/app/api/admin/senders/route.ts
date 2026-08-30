import { NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { bffFailure, bffUnauthorized } from "@/lib/server/bff-error";
import { listSenderQueue, SenderApiError } from "@/lib/server/senders-client";

export async function GET() {
  if (!(await readAdminSessionWithRefresh())) {
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  }
  try {
    return NextResponse.json(await listSenderQueue());
  } catch (error) {
    return error instanceof SenderApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure(
          "senders_unavailable",
          "Senders service is unavailable.",
          502,
        );
  }
}

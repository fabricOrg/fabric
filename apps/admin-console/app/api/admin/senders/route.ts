import { NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { listSenderQueue, SenderApiError } from "@/lib/server/senders-client";

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

export async function GET() {
  if (!(await readAdminSessionWithRefresh())) {
    return fail("invalid_session", "Staff sign-in required.", 401);
  }
  try {
    return NextResponse.json(await listSenderQueue());
  } catch (error) {
    return error instanceof SenderApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : fail(
          "senders_unavailable",
          "Senders service is unavailable.",
          502,
          "api_error",
        );
  }
}

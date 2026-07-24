import { sendMagicCode } from "@app/fe-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { customerRealmConfig, workosAuthConfigured } from "@/lib/server/auth";
import { allowCredentialAttempt } from "@/lib/server/auth-rate-limit";
import { isCrossSiteRequest } from "@/lib/server/auth-request";

const startSchema = z.object({ email: z.string().trim().email().max(320) });

/**
 * ADR-0008: passwordless — email a one-time code. Response is ALWAYS a neutral "check your email"
 * (enumeration-safe): whether the address exists or the send hiccupped, the screen looks the same.
 */
export async function POST(request: Request) {
  if (isCrossSiteRequest(request)) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  if (!workosAuthConfigured()) {
    return NextResponse.json(
      { outcome: "error", message: "Sign-in is not configured." },
      { status: 503 },
    );
  }
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { outcome: "invalid_request", message: "Enter your email." },
      { status: 400 },
    );
  }
  if (!(await allowCredentialAttempt(parsed.data.email))) {
    return NextResponse.json(
      {
        outcome: "rate_limited",
        message: "Too many attempts. Try again later.",
      },
      { status: 429 },
    );
  }
  await sendMagicCode(customerRealmConfig(), parsed.data.email);
  return NextResponse.json({ outcome: "code_sent", email: parsed.data.email });
}

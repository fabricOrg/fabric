import { verifyEmailCode } from "@app/fe-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { customerRealmConfig, workosAuthConfigured } from "@/lib/server/auth";
import { allowCredentialAttempt } from "@/lib/server/auth-rate-limit";
import { credentialResponse } from "@/lib/server/credential-landing";

const verifySchema = z.object({
  code: z.string().trim().min(1).max(20),
  pending_authentication_token: z.string().min(1),
  // Carried only to rate-limit the code attempts by target address.
  email: z.string().trim().email().max(320),
});

/** ADR-0008: confirm the emailed verification code and seal the session. */
export async function POST(request: Request) {
  if (!workosAuthConfigured()) {
    return NextResponse.json(
      { outcome: "error", message: "Sign-in is not configured." },
      { status: 503 },
    );
  }
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        outcome: "invalid_request",
        message: "Enter the code from your email.",
      },
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
  const outcome = await verifyEmailCode(customerRealmConfig(), {
    code: parsed.data.code,
    pendingAuthenticationToken: parsed.data.pending_authentication_token,
  });
  return credentialResponse(outcome);
}

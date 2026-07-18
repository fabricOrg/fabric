import { signInWithMagicCode } from "@app/fe-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { customerRealmConfig, workosAuthConfigured } from "@/lib/server/auth";
import { allowCredentialAttempt } from "@/lib/server/auth-rate-limit";
import { credentialResponse } from "@/lib/server/credential-landing";

const verifySchema = z.object({
  email: z.string().trim().email().max(320),
  code: z.string().trim().min(1).max(20),
});

/** ADR-0008: complete passwordless sign-in with the emailed code. */
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
  const outcome = await signInWithMagicCode(customerRealmConfig(), {
    email: parsed.data.email,
    code: parsed.data.code,
  });
  return credentialResponse(outcome);
}

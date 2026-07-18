import { signUpWithPassword } from "@app/fe-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { customerRealmConfig, workosAuthConfigured } from "@/lib/server/auth";
import { allowCredentialAttempt } from "@/lib/server/auth-rate-limit";
import { credentialResponse } from "@/lib/server/credential-landing";

const signUpSchema = z.object({
  email: z.string().trim().email().max(320),
  // WorkOS enforces its own password policy; a floor here gives an instant client-side check.
  password: z.string().min(8).max(400),
  first_name: z.string().trim().max(120).optional(),
  last_name: z.string().trim().max(120).optional(),
});

/** ADR-0008: self-serve sign-up — createUser + immediate auth; unverified ⇒ verification_required. */
export async function POST(request: Request) {
  if (!workosAuthConfigured()) {
    return NextResponse.json(
      { outcome: "error", message: "Sign-up is not configured." },
      { status: 503 },
    );
  }
  const parsed = signUpSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        outcome: "invalid_request",
        message: "Enter your email and a password of at least 8 characters.",
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
  const outcome = await signUpWithPassword(customerRealmConfig(), {
    email: parsed.data.email,
    password: parsed.data.password,
    ...(parsed.data.first_name ? { firstName: parsed.data.first_name } : {}),
    ...(parsed.data.last_name ? { lastName: parsed.data.last_name } : {}),
  });
  return credentialResponse(outcome);
}

import { signInWithPassword } from "@app/fe-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { customerRealmConfig, workosAuthConfigured } from "@/lib/server/auth";
import { allowCredentialAttempt } from "@/lib/server/auth-rate-limit";
import { credentialResponse } from "@/lib/server/credential-landing";

const signInSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(400),
});

/** ADR-0008: email + password sign-in — the BFF calls WorkOS, the browser never does. */
export async function POST(request: Request) {
  if (!workosAuthConfigured()) {
    return NextResponse.json(
      { outcome: "error", message: "Sign-in is not configured." },
      { status: 503 },
    );
  }
  const parsed = signInSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { outcome: "invalid_request", message: "Enter your email and password." },
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
  // Password is used here and dropped — never persisted, logged, or echoed (ADR-0008).
  const outcome = await signInWithPassword(customerRealmConfig(), {
    email: parsed.data.email,
    password: parsed.data.password,
  });
  return credentialResponse(outcome);
}

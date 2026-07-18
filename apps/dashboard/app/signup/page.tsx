import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import {
  readDashboardUserSession,
  workosAuthConfigured,
} from "@/lib/server/auth";

/**
 * ADR-0008: Fabric-owned sign-up. Verified strangers land in /onboarding to name their first
 * workspace (ADR-0007). Auth misconfigured → hosted AuthKit fallback.
 */
// Auth surface: reads cookies + session; never prerender or cache it.
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (!workosAuthConfigured()) redirect("/auth/login?screen_hint=sign-up");
  if (await readDashboardUserSession()) redirect("/");
  return (
    <AuthShell
      heading="Create your account"
      subheading="Start sending in the sandbox — no card required."
    >
      <SignUpForm />
    </AuthShell>
  );
}

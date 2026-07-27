import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import {
  AUTH_NOTICE_COOKIE,
  readDashboardUserSession,
  workosAuthConfigured,
} from "@/lib/server/auth";

/**
 * ADR-0008: Fabric-owned sign-in. Already signed in → into the app (the workspace gate routes to
 * onboarding/picker). Auth misconfigured → the hosted AuthKit page is the safe fallback.
 *
 * Renders the flash banners the old /login page owned: `?error=` (route failures) and the notice
 * cookie (access_denied / signed_out) that survives the WorkOS logout hop. /login now forwards here.
 */
type Banner = {
  variant: "destructive" | "default";
  title: string;
  description: string;
};

const ERROR_COPY: Record<string, Banner> = {
  authentication: {
    variant: "destructive",
    title: "Sign-in didn't complete",
    description:
      "We couldn't verify your session with the identity provider. Please try again.",
  },
  config: {
    variant: "destructive",
    title: "Sign-in unavailable",
    description:
      "Authentication isn't configured right now. Contact your administrator.",
  },
  access_denied: {
    variant: "destructive",
    title: "Access denied",
    description:
      "You signed in, but this account couldn't be verified. Try a different account.",
  },
  session: {
    variant: "destructive",
    title: "Session expired",
    description: "Your session ended. Sign in again to continue.",
  },
  // Shown only when the console's URL isn't configured here; normally the callback forwards
  // operators straight to it rather than landing them back on this page.
  staff_account: {
    variant: "default",
    title: "That's a Fabric staff account",
    description:
      "Sign in at the Fabric admin console instead. To use the dashboard, sign in with a workspace account.",
  },
};

const NOTICE_COPY: Record<string, Banner> = {
  access_denied: ERROR_COPY.access_denied as Banner,
  signed_out: {
    variant: "default",
    title: "Signed out",
    description: "You've been signed out. Sign in again to continue.",
  },
};

// Auth surface: reads cookies + session; never prerender or cache it.
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!workosAuthConfigured()) redirect("/auth/login");
  if (await readDashboardUserSession()) redirect("/");

  const { error } = await searchParams;
  const notice = (await cookies()).get(AUTH_NOTICE_COOKIE)?.value;
  const banner: Banner | null = error
    ? (ERROR_COPY[error] ?? {
        variant: "destructive",
        title: "Something went wrong",
        description: "We couldn't sign you in. Please try again.",
      })
    : notice
      ? (NOTICE_COPY[notice] ?? null)
      : null;

  return (
    <AuthShell
      heading="Welcome back"
      subheading="Sign in to continue to your workspace."
    >
      {banner ? (
        <Alert variant={banner.variant} role="alert" className="mb-6 text-left">
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.description}</AlertDescription>
        </Alert>
      ) : null}
      <SignInForm />
    </AuthShell>
  );
}

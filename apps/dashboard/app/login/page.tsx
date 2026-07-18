import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ContinueWithWorkOS } from "@/components/login/continue-with-workos";
import {
  AUTH_NOTICE_COOKIE,
  readDashboardUserSession,
  workosAuthConfigured,
} from "@/lib/server/auth";

/**
 * Production sign-in — Notion-style: a single, quiet, centered column on a neutral canvas. No split
 * hero, no card chrome. Sign-in + self-serve sign-up run through the WorkOS AuthKit hosted page
 * (email+password / Google / passkeys / SSO; register/MFA/reset are all WorkOS-hosted — we own no
 * credential forms). Theme aware via design tokens (light + dark).
 *
 * Two feedback channels: `?error=` (direct failures the routes set inline) and a flash NOTICE cookie
 * (access_denied / signed_out) that survives the WorkOS logout hop. Denials render destructive; a
 * plain sign-out renders as a neutral confirmation, not an error.
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
      "You signed in, but this account isn't a member of this workspace. Ask an admin to invite you, or try a different account.",
  },
  session: {
    variant: "destructive",
    title: "Session expired",
    description: "Your session ended. Sign in again to continue.",
  },
};

/** Flash-cookie notices. `signed_out` is a calm confirmation, not a failure. */
const NOTICE_COPY: Record<string, Banner> = {
  access_denied: ERROR_COPY.access_denied as Banner,
  signed_out: {
    variant: "default",
    title: "Signed out",
    description: "You've been signed out. Sign in again to continue.",
  },
};

/** Fabric logo — the indigo tile + white "F" from app/icon.svg, inlined. */
function FabricLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#3f3aa8" />
      <path d="M18 14h31v9H28v9h18v9H28v15H18z" fill="#fff" />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Already signed in (user-level — even without a selected workspace)? Don't show a login
  // button — send them into the app; the workspace gate routes to onboarding/picker as needed.
  if (await readDashboardUserSession()) redirect("/");

  const { error } = await searchParams;
  const workosEnabled = workosAuthConfigured();
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

  // No intermediate "click again" page: when sign-in is available and there's nothing to explain
  // (no error, no sign-out/denied notice), forward straight to the WorkOS AuthKit hosted page. A
  // user arriving from a "Sign in" link — in the docs, marketing, or another Fabric app — lands
  // directly on the auth experience, and passes straight through if they already hold a WorkOS
  // session. This page then renders ONLY to explain a denial/sign-out (with a retry), never as a
  // dead-end landing.
  if (workosEnabled && !banner) {
    redirect("/auth/login");
  }

  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      {/* centered column */}
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[340px] duration-200 animate-in fade-in">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <FabricLogo className="mb-3 size-12 rounded-2xl shadow-sm" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Log in to Fabric
            </h1>
            <p className="text-sm text-muted-foreground">
              Continue to your workspace
            </p>
          </div>

          {banner ? (
            <Alert
              variant={banner.variant}
              role="alert"
              className="mt-6 text-left"
            >
              <AlertTitle>{banner.title}</AlertTitle>
              <AlertDescription>{banner.description}</AlertDescription>
            </Alert>
          ) : null}

          {workosEnabled ? (
            <div className="mt-8 flex flex-col gap-3">
              <ContinueWithWorkOS />
              <p className="text-center text-xs text-muted-foreground">
                Secured by WorkOS · email, Google, passkey, or SSO.
              </p>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                New to Fabric?{" "}
                <a
                  href="/auth/login?screen_hint=sign-up"
                  className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
                >
                  Create an account
                </a>
              </p>
            </div>
          ) : (
            <Alert role="alert" className="mt-8 text-left">
              <AlertTitle>Sign-in unavailable</AlertTitle>
              <AlertDescription>
                Sign-in isn't configured for this environment.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      {/* tiny legal footer */}
      <footer className="px-6 pb-6 text-center text-xs text-muted-foreground">
        By continuing you agree to Fabric's acceptable-use &amp; compliance
        terms.
      </footer>
    </main>
  );
}

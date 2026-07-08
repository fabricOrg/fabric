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
  readDeveloperSession,
  workosAuthConfigured,
} from "@/lib/server/auth";

/**
 * Developer sign-in — same Notion-style launchpad as the customer dashboard, DEV-branded.
 * `?error=` covers direct failures; a flash NOTICE cookie (access_denied / signed_out) carries the
 * reason across the WorkOS logout hop so a denial explains itself instead of looking like a no-op.
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
      "Authentication isn't configured right now. Contact platform ops.",
  },
  access_denied: {
    variant: "destructive",
    title: "Access denied",
    description:
      "You signed in, but this account isn't on the developer allowlist. Ask an admin to invite you, or try a different account.",
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
  // Already signed in? Don't show a login button — send them into the portal.
  if (await readDeveloperSession()) redirect("/");

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

  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[340px] duration-200 animate-in fade-in">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <FabricLogo className="mb-3 size-12 rounded-2xl shadow-sm" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Fabric Developer Portal
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in to manage API keys and webhooks
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
                Secured by WorkOS.
              </p>
            </div>
          ) : (
            <Alert role="alert" className="mt-8 text-left">
              <AlertTitle>Sign-in unavailable</AlertTitle>
              <AlertDescription>
                Single sign-on isn't configured for this environment.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </main>
  );
}

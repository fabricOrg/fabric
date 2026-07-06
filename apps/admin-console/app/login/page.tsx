import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { ContinueWithWorkOS } from "@/components/login/continue-with-workos";
import { workosAuthConfigured } from "@/lib/server/auth";

/** Staff sign-in — same Notion-style launchpad as the customer dashboard, ADMIN-branded. */

const ERROR_COPY: Record<string, { title: string; description: string }> = {
  authentication: {
    title: "Sign-in didn't complete",
    description:
      "We couldn't verify your session with the identity provider. Please try again.",
  },
  config: {
    title: "Sign-in unavailable",
    description:
      "Authentication isn't configured right now. Contact platform ops.",
  },
  access_denied: {
    title: "Access denied",
    description: "This account isn't on the staff allowlist.",
  },
  session: {
    title: "Session expired",
    description: "Your session ended. Sign in again to continue.",
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
  const { error } = await searchParams;
  const workosEnabled = workosAuthConfigured();
  const err = error
    ? (ERROR_COPY[error] ?? {
        title: "Something went wrong",
        description: "We couldn't sign you in. Please try again.",
      })
    : null;

  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[340px] duration-200 animate-in fade-in">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <FabricLogo className="mb-3 size-12 rounded-2xl shadow-sm" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Fabric Staff Console
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in with your staff account
            </p>
          </div>

          {err ? (
            <Alert
              variant="destructive"
              role="alert"
              className="mt-6 text-left"
            >
              <AlertTitle>{err.title}</AlertTitle>
              <AlertDescription>{err.description}</AlertDescription>
            </Alert>
          ) : null}

          {workosEnabled ? (
            <div className="mt-8 flex flex-col gap-3">
              <ContinueWithWorkOS />
              <p className="text-center text-xs text-muted-foreground">
                Secured by WorkOS · staff access only.
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

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import { ContinueWithWorkOS } from "@/components/login/continue-with-workos";
import { developmentAuthConfig, workosAuthConfigured } from "@/lib/server/auth";

/** WorkOS callback failures redirect back here with ?error=…; map each to plain-language copy. */
const ERROR_COPY: Record<string, { title: string; description: string }> = {
  authentication: {
    title: "Sign-in didn't complete",
    description:
      "We couldn't verify your session with the identity provider. Please try again.",
  },
  config: {
    title: "Sign-in unavailable",
    description:
      "Authentication isn't configured right now. Contact your administrator.",
  },
  access_denied: {
    title: "Access denied",
    description: "This account isn't permitted to enter this workspace.",
  },
  session: {
    title: "Session expired",
    description: "Your session ended. Sign in again to continue.",
  },
};

function FabricWordmark({ onDark = false }: { onDark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`flex size-9 flex-col items-center justify-center gap-[3px] rounded-md ${
          onDark ? "bg-primary-foreground" : "bg-primary"
        }`}
        aria-hidden="true"
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-0.5 w-4 rounded-full ${
              onDark ? "bg-primary" : "bg-primary-foreground"
            }`}
          />
        ))}
      </div>
      <span className="font-display text-xl font-semibold tracking-tight">
        Fabric
      </span>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const workosEnabled = workosAuthConfigured();
  const developmentEnabled = developmentAuthConfig().enabled;
  const err = error
    ? (ERROR_COPY[error] ?? {
        title: "Something went wrong",
        description: "We couldn't sign you in. Please try again.",
      })
    : null;

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — desktop only. Keeps Fabric's identity present through the WorkOS hop. */}
      <div className="relative hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <FabricWordmark onDark />
        <div className="flex max-w-md flex-col gap-4">
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight">
            Messaging, payments and identity for Africa.
          </h1>
          <p className="text-primary-foreground/80">
            One platform to reach every customer — SMS, WhatsApp and USSD — with
            a wallet and verification built in.
          </p>
        </div>
        <p className="text-sm text-primary-foreground/60">
          © Fabric · Ghana &amp; West Africa
        </p>
      </div>

      {/* Auth panel */}
      <div className="flex items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="lg:hidden">
            <FabricWordmark />
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Sign in
            </h2>
            <p className="text-sm text-muted-foreground">
              Continue to your customer workspace.
            </p>
          </div>

          {err ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>{err.title}</AlertTitle>
              <AlertDescription>{err.description}</AlertDescription>
            </Alert>
          ) : null}

          {!workosEnabled && !developmentEnabled ? (
            <Alert role="alert">
              <AlertTitle>Sign-in unavailable</AlertTitle>
              <AlertDescription>
                No authentication method is configured for this environment.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-4">
            {workosEnabled ? <ContinueWithWorkOS /> : null}

            {workosEnabled && developmentEnabled ? (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}

            {developmentEnabled ? (
              <div className="flex flex-col gap-1.5">
                <form action="/auth/development" method="post">
                  <Button className="w-full" type="submit" variant="outline">
                    Development workspace
                  </Button>
                </form>
                <p className="text-center text-xs text-muted-foreground">
                  Dev-only bypass — never available in production.
                </p>
              </div>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            By continuing you agree to Fabric's acceptable-use and messaging
            compliance terms.
          </p>
        </div>
      </div>
    </main>
  );
}

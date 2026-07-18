import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { StaffSignInForm } from "@/components/auth/staff-sign-in-form";
import {
  AUTH_NOTICE_COOKIE,
  readAdminSession,
  workosAuthConfigured,
} from "@/lib/server/auth";

/**
 * ADR-0008: Fabric-owned STAFF sign-in (admin console). Renders our own credential UI — the hosted
 * AuthKit page (and its org-selection screen) is bypassed. Misconfigured → hosted fallback.
 * Renders the flash banners /login used to own; /login now forwards here.
 */
export const dynamic = "force-dynamic";

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
      "This account isn't on the staff allowlist. Ask platform ops for access.",
  },
  session: {
    variant: "destructive",
    title: "Session expired",
    description: "Your session ended. Sign in again to continue.",
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

export default async function StaffSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!workosAuthConfigured()) redirect("/auth/login");
  if (await readAdminSession()) redirect("/");

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
      heading="Staff sign-in"
      subheading="Sign in to the Fabric control plane."
    >
      {banner ? (
        <Alert variant={banner.variant} role="alert" className="mb-6 text-left">
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.description}</AlertDescription>
        </Alert>
      ) : null}
      <StaffSignInForm />
    </AuthShell>
  );
}

"use client";

import { Alert, AlertDescription } from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/** Shared bits for the ADR-0008 auth screens: Google button, divider, error, submit. */

export interface OutcomeJson {
  outcome: string;
  next?: string;
  href?: string;
  message?: string;
  pending_authentication_token?: string;
  email?: string;
}

/**
 * Act on a credential response. Returns a human message when the screen must stay put (bad
 * credentials, rate limit, transient); navigates away (and never returns) on success or a
 * hosted-fallback handoff. `verification_required` is handled by the caller, not here.
 */
export function actOnOutcome(json: OutcomeJson): string | null {
  switch (json.outcome) {
    case "authenticated":
      window.location.assign(json.next ?? "/");
      return null;
    case "fallback_hosted":
      window.location.assign(json.href ?? "/auth/login");
      return null;
    case "invalid_credentials":
      return "That email or password is incorrect.";
    case "rate_limited":
      return json.message ?? "Too many attempts. Try again in a few minutes.";
    case "invalid_request":
      return json.message ?? "Check your details and try again.";
    default:
      return json.message ?? "Something went wrong. Please try again.";
  }
}

export function GoogleButton({
  screenHint,
  label,
}: {
  screenHint?: "sign-up";
  label: string;
}) {
  const href = screenHint
    ? "/api/auth/google?screen_hint=sign-up"
    : "/api/auth/google";
  return (
    <Button
      asChild
      variant="outline"
      className="h-11 w-full justify-center gap-2 font-normal"
    >
      <a href={href}>
        <GoogleGlyph />
        {label}
      </a>
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({
  pending,
  pendingLabel,
  children,
  disabled,
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      className="h-11 w-full"
      disabled={pending || disabled}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

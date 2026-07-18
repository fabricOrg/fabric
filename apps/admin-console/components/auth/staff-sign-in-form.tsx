"use client";

import { type FormEvent, useState } from "react";
import {
  AuthError,
  actOnOutcome,
  GoogleButton,
  OrDivider,
  type OutcomeJson,
  SubmitButton,
} from "./auth-atoms";
import { EmailField, PasswordField } from "./auth-fields";

/**
 * ADR-0008 Fabric-owned STAFF sign-in. Password + Google only — no self-serve sign-up (staff are
 * invite-only/allowlisted) and no email-code/magic step. The BFF calls WorkOS directly, so the
 * hosted AuthKit page and its organization-selection screen never appear.
 */
export function StaffSignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = (await response.json().catch(() => ({}))) as OutcomeJson;
      const message = actOnOutcome(json); // navigates on success / hosted fallback
      if (message) {
        setError(message);
        setPending(false);
      }
    } catch {
      setError("Something went wrong. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <EmailField
          value={email}
          onChange={setEmail}
          disabled={pending}
          autoFocus
        />
        <PasswordField
          value={password}
          onChange={setPassword}
          disabled={pending}
        />

        <AuthError>{error}</AuthError>

        <SubmitButton
          pending={pending}
          pendingLabel="Signing in…"
          disabled={!email.trim() || !password}
        >
          Sign in
        </SubmitButton>
      </form>

      <OrDivider />
      <GoogleButton label="Sign in with Google" />

      <p className="mt-2 text-center text-xs text-muted-foreground">
        Staff access is invite-only. Contact platform ops if you need an
        account.
      </p>
    </div>
  );
}

"use client";

import { Input } from "@app/ui/components/ui/input";
import { Label } from "@app/ui/components/ui/label";
import { type FormEvent, useState } from "react";
import {
  AuthError,
  actOnOutcome,
  type OutcomeJson,
  SubmitButton,
} from "./auth-atoms";

/**
 * ADR-0008 one-time-code step, shared by email verification (post sign-up / unverified sign-in)
 * and passwordless magic-code sign-in. Both POST a 6-digit code; the endpoint + extra field differ.
 */
export function CodePanel({
  email,
  variant,
  pendingAuthenticationToken,
  onBack,
}: {
  email: string;
  variant: "email-verification" | "magic";
  pendingAuthenticationToken?: string;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || code.trim().length === 0) return;
    setPending(true);
    setError(null);
    const endpoint =
      variant === "magic" ? "/api/auth/magic/verify" : "/api/auth/verify-email";
    const body =
      variant === "magic"
        ? { email, code: code.trim() }
        : {
            email,
            code: code.trim(),
            pending_authentication_token: pendingAuthenticationToken,
          };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => ({}))) as OutcomeJson;
      const message = actOnOutcome(json); // navigates on success
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        We emailed a sign-in code to{" "}
        <span className="font-medium text-foreground">{email}</span>.
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Verification code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          autoFocus
          maxLength={10}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          disabled={pending}
          className="tracking-[0.3em]"
        />
      </div>

      <AuthError>{error}</AuthError>

      <SubmitButton
        pending={pending}
        pendingLabel="Verifying…"
        disabled={code.trim().length === 0}
      >
        Continue
      </SubmitButton>

      <button
        type="button"
        onClick={onBack}
        className="text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Use a different email
      </button>
    </form>
  );
}

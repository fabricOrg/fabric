"use client";

import Link from "next/link";
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
import { CodePanel } from "./code-panel";

type Step =
  | { name: "password" }
  | { name: "magic-email" }
  | { name: "magic-code"; email: string }
  | { name: "verify"; email: string; pendingAuthenticationToken: string };

export function SignInForm() {
  const [step, setStep] = useState<Step>({ name: "password" });

  if (step.name === "magic-code") {
    return (
      <CodePanel
        email={step.email}
        variant="magic"
        onBack={() => setStep({ name: "password" })}
      />
    );
  }
  if (step.name === "verify") {
    return (
      <CodePanel
        email={step.email}
        variant="email-verification"
        pendingAuthenticationToken={step.pendingAuthenticationToken}
        onBack={() => setStep({ name: "password" })}
      />
    );
  }
  if (step.name === "magic-email") {
    return (
      <MagicEmailForm
        onSent={(email) => setStep({ name: "magic-code", email })}
        onBack={() => setStep({ name: "password" })}
      />
    );
  }
  return (
    <PasswordForm
      onVerify={(email, pendingAuthenticationToken) =>
        setStep({ name: "verify", email, pendingAuthenticationToken })
      }
      onMagic={() => setStep({ name: "magic-email" })}
    />
  );
}

function PasswordForm({
  onVerify,
  onMagic,
}: {
  onVerify: (email: string, pendingAuthenticationToken: string) => void;
  onMagic: () => void;
}) {
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
      if (json.outcome === "verification_required") {
        onVerify(
          json.email ?? email.trim(),
          json.pending_authentication_token ?? "",
        );
        return;
      }
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
          headerAction={
            // Reset stays on hosted AuthKit (ADR-0008) — it sends the WorkOS-branded email.
            <a
              href="/auth/login"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </a>
          }
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

      <button
        type="button"
        onClick={onMagic}
        className="text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Email me a sign-in code instead
      </button>

      <OrDivider />
      <GoogleButton label="Sign in with Google" />

      <p className="mt-2 text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link
          href="/signup"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Create one now
        </Link>
      </p>
    </div>
  );
}

function MagicEmailForm({
  onSent,
  onBack,
}: {
  onSent: (email: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !email.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/magic/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = (await response.json().catch(() => ({}))) as OutcomeJson;
      if (json.outcome === "code_sent") {
        onSent(email.trim());
        return;
      }
      setError(actOnOutcome(json) ?? "Please try again.");
      setPending(false);
    } catch {
      setError("Something went wrong. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <EmailField
        id="magic-email"
        value={email}
        onChange={setEmail}
        disabled={pending}
        autoFocus
      />

      <AuthError>{error}</AuthError>

      <SubmitButton
        pending={pending}
        pendingLabel="Sending…"
        disabled={!email.trim()}
      >
        Email me a code
      </SubmitButton>

      <button
        type="button"
        onClick={onBack}
        className="text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Back to password sign-in
      </button>
    </form>
  );
}

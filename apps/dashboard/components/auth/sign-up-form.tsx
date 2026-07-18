"use client";

import { Input } from "@app/ui/components/ui/input";
import { Label } from "@app/ui/components/ui/label";
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
import { CodePanel } from "./code-panel";

type Step =
  | { name: "form" }
  | { name: "verify"; email: string; pendingAuthenticationToken: string };

export function SignUpForm() {
  const [step, setStep] = useState<Step>({ name: "form" });

  if (step.name === "verify") {
    return (
      <CodePanel
        email={step.email}
        variant="email-verification"
        pendingAuthenticationToken={step.pendingAuthenticationToken}
        onBack={() => setStep({ name: "form" })}
      />
    );
  }
  return (
    <CreateAccountForm
      onVerify={(email, pendingAuthenticationToken) =>
        setStep({ name: "verify", email, pendingAuthenticationToken })
      }
    />
  );
}

function CreateAccountForm({
  onVerify,
}: {
  onVerify: (email: string, pendingAuthenticationToken: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const [firstName, ...rest] = name.trim().split(/\s+/);
    try {
      const response = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          ...(firstName ? { first_name: firstName } : {}),
          ...(rest.length ? { last_name: rest.join(" ") } : {}),
        }),
      });
      const json = (await response.json().catch(() => ({}))) as OutcomeJson;
      if (json.outcome === "verification_required") {
        onVerify(
          json.email ?? email.trim(),
          json.pending_authentication_token ?? "",
        );
        return;
      }
      if (json.outcome === "invalid_credentials") {
        // 409 email-exists surfaces here (enumeration-safe on the API side) — steer to sign-in.
        setError("That email can't be used. Try signing in instead.");
        setPending(false);
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Ama Mensah"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </div>

        <AuthError>{error}</AuthError>

        <SubmitButton
          pending={pending}
          pendingLabel="Creating account…"
          disabled={!email.trim() || password.length < 8}
        >
          Create account
        </SubmitButton>
      </form>

      <OrDivider />
      <GoogleButton label="Sign up with Google" />

      <p className="mt-2 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/signin"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

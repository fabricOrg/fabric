"use client";

import { Alert, AlertDescription } from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import { Input } from "@app/ui/components/ui/input";
import { Label } from "@app/ui/components/ui/label";
import { Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";

/**
 * One-field onboarding form: workspace name → POST /api/onboarding/workspace. On success the
 * route sets the workspace selector cookie, so we hard-navigate into the app (a client-side
 * transition would race the cookie).
 */
export function OnboardingWorkspaceForm() {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const workspaceName = name.trim();
    if (!workspaceName || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace_name: workspaceName }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(
          payload?.error?.message ??
            "We couldn't create your workspace. Please try again.",
        );
        setSubmitting(false);
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Something went wrong. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          name="workspace-name"
          placeholder="e.g. Kente Labs"
          autoFocus
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={submitting}
        />
        <p className="text-xs text-muted-foreground">
          Usually your company or team name. You can invite teammates later.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={submitting || name.trim().length === 0}>
        {submitting ? (
          <>
            <Loader2 data-icon="inline-start" className="animate-spin" />
            Creating workspace…
          </>
        ) : (
          "Create workspace"
        )}
      </Button>
    </form>
  );
}

"use client";

import { Button } from "@app/ui/components/ui/button";
import { UserCog, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Never-silent impersonation banner. The active claim is read server-side (sealed cookie) and passed
 * in; this client piece renders the live countdown + "End now". Persists across every page in the
 * shell so an operator can never forget they're acting as a tenant. Auto-ends when the window
 * elapses (fail-safe).
 */
export function ImpersonationBanner({
  claim,
}: {
  claim: { tenantLabel: string; endsAt: number } | null;
}) {
  const router = useRouter();
  const [, tick] = useState(0);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!claim) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [claim]);

  async function end() {
    setEnding(true);
    try {
      await fetch("/api/admin/impersonation/stop", { method: "POST" });
    } finally {
      router.refresh();
    }
  }

  if (!claim) return null;
  const remaining = Math.max(0, Math.floor((claim.endsAt - Date.now()) / 1000));
  if (remaining === 0 && !ending) {
    // Window elapsed — auto-end (never leave a stale impersonation).
    queueMicrotask(end);
    return null;
  }
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning/15 px-4 py-2 text-sm text-warning"
    >
      <UserCog className="size-4 shrink-0" />
      <span className="font-medium">
        Viewing as{" "}
        <span className="font-semibold text-foreground">
          {claim.tenantLabel}
        </span>
      </span>
      <span className="font-mono tabular-nums">
        ends in {mm}:{ss}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto"
        loading={ending}
        onClick={end}
      >
        <X data-icon="inline-start" />
        End now
      </Button>
    </div>
  );
}

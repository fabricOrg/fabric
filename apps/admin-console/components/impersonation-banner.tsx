"use client";

import { Button } from "@app/ui/components/ui/button";
import { UserCog, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Never-silent impersonation banner. Persists across every page in the shell for the entire
 * impersonation window with a live countdown — an operator can never forget they're acting as a
 * tenant. (Mock: session-scoped in sessionStorage; PI-3 wires the real time-boxed ImpersonationClaim
 * from the fe-auth session.)
 */
interface Session {
  tenant: string;
  endsAt: number;
}
const KEY = "fabric-impersonation";
export const IMPERSONATION_EVENT = "fabric-impersonation-change";

export function ImpersonationBanner() {
  const [session, setSession] = useState<Session | null>(null);
  const [, tick] = useState(0);

  const read = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      setSession(raw ? (JSON.parse(raw) as Session) : null);
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    read();
    window.addEventListener(IMPERSONATION_EVENT, read);
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      window.removeEventListener(IMPERSONATION_EVENT, read);
      clearInterval(t);
    };
  }, [read]);

  const end = useCallback(() => {
    sessionStorage.removeItem(KEY);
    window.dispatchEvent(new Event(IMPERSONATION_EVENT));
    setSession(null);
  }, []);

  if (!session) return null;
  const remaining = Math.max(
    0,
    Math.floor((session.endsAt - Date.now()) / 1000),
  );
  if (remaining === 0) {
    // window elapsed — auto-end (fail-safe: never leave a stale impersonation).
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
        <span className="font-semibold text-foreground">{session.tenant}</span>
      </span>
      <span className="font-mono tabular-nums">
        ends in {mm}:{ss}
      </span>
      <Button size="sm" variant="outline" className="ml-auto" onClick={end}>
        <X data-icon="inline-start" />
        End now
      </Button>
    </div>
  );
}

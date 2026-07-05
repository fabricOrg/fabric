"use client";

import { Button } from "@app/ui/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";

/**
 * WorkOS sign-in trigger, Notion-style: a neutral full-width outline button. /auth/login 302s to the
 * WorkOS hosted page (a full navigation), so on click we flip to an explicit "Redirecting…" state so
 * the hop reads as intentional rather than a dead flicker.
 */
export function ContinueWithWorkOS({ screenHint }: { screenHint?: "sign-up" }) {
  const [pending, setPending] = useState(false);
  const href =
    screenHint === "sign-up"
      ? "/auth/login?screen_hint=sign-up"
      : "/auth/login";

  return (
    <Button
      asChild
      variant="outline"
      className="h-11 w-full justify-center gap-2 font-normal"
    >
      <a
        href={href}
        aria-busy={pending}
        onClick={() => setPending(true)}
        className={pending ? "pointer-events-none" : undefined}
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Redirecting…
          </>
        ) : (
          <>
            <ShieldCheck className="size-4" />
            Continue with WorkOS SSO
          </>
        )}
      </a>
    </Button>
  );
}

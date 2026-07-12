"use client";

import { Button } from "@app/ui/components/ui/button";
import { Loader2, LogIn } from "lucide-react";
import { useState } from "react";

/** Sign-in trigger — mirrors the dashboard's (see apps/dashboard/components/login). Bounces to the
 *  WorkOS AuthKit hosted page (email+password / Google / passkeys / SSO). */
export function ContinueWithWorkOS() {
  const [pending, setPending] = useState(false);

  return (
    <Button
      asChild
      variant="outline"
      className="h-11 w-full justify-center gap-2 font-normal"
    >
      <a
        href="/auth/login"
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
            <LogIn className="size-4" />
            Sign in
          </>
        )}
      </a>
    </Button>
  );
}

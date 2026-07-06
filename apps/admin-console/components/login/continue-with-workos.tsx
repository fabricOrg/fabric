"use client";

import { Button } from "@app/ui/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";

/** WorkOS sign-in trigger — mirrors the dashboard's (see apps/dashboard/components/login). */
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
            <ShieldCheck className="size-4" />
            Continue with WorkOS SSO
          </>
        )}
      </a>
    </Button>
  );
}

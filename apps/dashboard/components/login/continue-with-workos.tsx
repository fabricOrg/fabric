"use client";

import { Button } from "@app/ui/components/ui/button";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";

/**
 * WorkOS sign-in trigger. /auth/login 302s out to the WorkOS hosted page, so the click causes a
 * full-page navigation. Without feedback that reads as "nothing happened" (the flow users disliked):
 * we flip to an explicit "Redirecting to secure sign-in…" state on click so the hop feels intentional.
 */
export function ContinueWithWorkOS({ screenHint }: { screenHint?: "sign-up" }) {
  const [pending, setPending] = useState(false);
  const href =
    screenHint === "sign-up"
      ? "/auth/login?screen_hint=sign-up"
      : "/auth/login";

  return (
    <Button asChild className="w-full">
      <a
        href={href}
        aria-busy={pending}
        onClick={() => setPending(true)}
        className={pending ? "pointer-events-none" : undefined}
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" data-icon="inline-start" />
            Redirecting to secure sign-in…
          </>
        ) : (
          <>
            Continue with WorkOS
            <ArrowRight data-icon="inline-end" />
          </>
        )}
      </a>
    </Button>
  );
}

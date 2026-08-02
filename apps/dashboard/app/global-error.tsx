"use client";

import { Button } from "@app/ui/components/ui/button";
import { TriangleAlert } from "lucide-react";
import "./globals.css";

/**
 * Last-resort boundary: this catches a throw in the ROOT layout itself, which the `(app)` boundary
 * cannot — by the time the root layout fails there is no shell left to render inside.
 *
 * Next replaces the entire document here, so this file owns `<html>` and `<body>` and re-imports
 * the stylesheet; it cannot rely on the theme provider, fonts or any context the root layout sets
 * up, because the thing that failed is exactly that. Keep it dependency-light on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-destructive/12 text-destructive">
            <TriangleAlert className="size-6" aria-hidden="true" />
          </span>
          <h1 className="font-display font-semibold text-xl tracking-tight">
            Fabric couldn&apos;t load
          </h1>
          <p className="text-muted-foreground text-sm">
            Something failed before the dashboard could start. Your workspace
            and balance are unaffected — nothing was changed.
          </p>
          {error.digest ? (
            <p className="text-muted-foreground text-xs">
              Contact support with{" "}
              <code className="font-mono">{error.digest}</code>.
            </p>
          ) : null}
          <Button onClick={reset}>Try again</Button>
        </main>
      </body>
    </html>
  );
}

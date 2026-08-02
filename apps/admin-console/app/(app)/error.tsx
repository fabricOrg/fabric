"use client";

import { RouteError } from "@app/ui/components/ui/route-error";

/**
 * Boundary for every staff console route that does not define its own. Sits inside the `(app)`
 * layout so a failing page keeps the navigation, which matters more here than in the customer app:
 * an operator hitting this mid-incident still needs to reach the kill-switches.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="this page"
      message="This page failed to render. No tenant data was changed, and no action you took has been applied."
    />
  );
}

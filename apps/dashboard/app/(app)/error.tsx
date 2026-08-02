"use client";

import { RouteError } from "@app/ui/components/ui/route-error";

/**
 * Boundary for every signed-in dashboard route that does not define its own. It sits INSIDE the
 * `(app)` layout, so a failing page loses the content area but keeps the sidebar, topbar and
 * navigation — the user can still get somewhere else instead of staring at a blank shell.
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
      message="This page failed to render. Your workspace, balance and messages are unaffected — nothing was changed."
    />
  );
}

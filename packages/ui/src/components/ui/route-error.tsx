"use client";

import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";

/**
 * Standard `error.tsx` body for a route segment or app group, shared across all Fabric apps.
 *
 * Without a boundary, one render throw unmounts the whole tree and the user gets a blank shell with
 * no navigation and no way back. Mounting this at the `(app)` layout level keeps the failure inside
 * the content area, so the sidebar still works and `reset()` can retry the segment.
 *
 * `digest` is all the client is given of a server-side error — Next strips the real message in
 * production — and it is the only handle that correlates to a server log line, so it is surfaced as
 * the support reference rather than swallowed.
 *
 *   "use client";
 *   export default function Error(props) { return <RouteError {...props} title="Dashboard" />; }
 */
export function RouteError({
  error,
  reset,
  title = "Something went wrong",
  description,
  message = "This page failed to render. Nothing you were viewing has been changed.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Page title, so the shell still reads as the page you navigated to. */
  title?: string;
  description?: string;
  /** What the user should take from the failure. Keep it about consequences, not stack traces. */
  message?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>{title}</PageHeaderTitle>
          {description ? (
            <PageHeaderDescription>{description}</PageHeaderDescription>
          ) : null}
        </PageHeaderHeading>
      </PageHeader>
      <ErrorState
        title={`Couldn't load ${title}`}
        message={message}
        {...(error.digest ? { requestId: error.digest } : {})}
        onRetry={reset}
      />
    </div>
  );
}

"use client";

import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";

/**
 * Segment error boundary. The page already renders `ErrorState` for a wallet read it EXPECTS to
 * fail; this catches what it does not — a render throw, a contract parse mismatch after a deploy —
 * so the failure stays inside the wallet route instead of blanking the whole dashboard shell.
 *
 * `digest` is all a client gets of a server-side error (Next strips the message in production), and
 * it is the only handle support can correlate to a log line, so it is surfaced as the request id.
 */
export default function WalletError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Wallet &amp; Billing</PageHeaderTitle>
          <PageHeaderDescription>
            Balances, top-ups, and your double-entry transaction history.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>
      <ErrorState
        title="Couldn't load Wallet & Billing"
        message="Something went wrong rendering this page. Your balance and credits are unaffected — no money moved."
        {...(error.digest ? { requestId: error.digest } : {})}
        onRetry={reset}
      />
    </div>
  );
}

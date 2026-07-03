// F8.3 error surface — the ONE place an API error becomes a toast. Parses the shared envelope via
// @app/contracts (never throws), shows the user-safe message, and always surfaces the `request_id`
// ("contact support with req_…") so support has a handle. Every lane's failed call routes through here.

import { type ParsedApiError, parseApiError } from "@app/contracts";
import { toast } from "sonner";

export interface ToastApiErrorOptions {
  /** request id read from a response header when the body omitted it. */
  readonly requestIdFallback?: string;
  /** optional action, e.g. { label: "Top up", onClick } for a 402 → wallet. */
  readonly action?: { label: string; onClick: () => void };
}

/** Show an API error as a toast. Returns the parsed error so callers can branch (e.g. 402 → /wallet). */
export function toastApiError(
  payload: unknown,
  opts: ToastApiErrorOptions = {},
): ParsedApiError {
  const err = parseApiError(payload, opts.requestIdFallback);
  toast.error(err.message, {
    description: err.requestId
      ? `Contact support with ${err.requestId}`
      : undefined,
    ...(opts.action ? { action: opts.action } : {}),
  });
  return err;
}

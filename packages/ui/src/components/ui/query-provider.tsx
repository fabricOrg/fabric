"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

/**
 * Shared TanStack Query provider — each app wraps its tree once (in the root layout). A stable client
 * is created per browser session (useState initialiser, never re-created on render). Sensible control-
 * plane defaults: short staleness, one retry, no refetch-on-focus (the dashboards aren't live tickers).
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

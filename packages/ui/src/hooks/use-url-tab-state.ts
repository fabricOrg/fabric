"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tab selection that survives a reload, a copied link, and browser back/forward.
 *
 * A tab is navigation state, so losing it on refresh is a real defect: a customer sent a link to
 * "the Credits tab" and the recipient landed on Overview, and anyone who reloaded after a payment
 * bounced back to the wrong panel.
 *
 * `initial` MUST come from the server (read the same key off `searchParams` in the page and pass it
 * down). Reading the URL in a `useState` initialiser instead would render one tab on the server and
 * a different one on the client — a hydration mismatch, and a visible flash of the wrong panel.
 *
 * Deliberately built on the History API rather than a router hook: this package carries no
 * framework dependency, and a tab switch should not re-run a server component just to move a
 * client-side selection. `replaceState` also keeps the back button meaning "the previous page",
 * not "the previous tab" — but a back/forward across an entry that does differ is still honoured,
 * via `popstate`.
 *
 *   // server:  <WalletTabs defaultTab={parseTab(searchParams.tab)} … />
 *   // client:  const [tab, setTab] = useUrlTabState("tab", defaultTab);
 */
export function useUrlTabState<T extends string>(
  key: string,
  initial: T,
  /** Accepted values. A URL carrying anything else falls back to `initial`. */
  allowed: readonly T[],
): [T, (next: T) => void] {
  const [tab, setTab] = useState<T>(initial);

  const select = useCallback(
    (next: T) => {
      setTab(next);
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      if (url.searchParams.get(key) === next) return;
      url.searchParams.set(key, next);
      // replaceState, not pushState: a tab is a view of one page, so it should not stack history
      // entries that the back button then has to chew through.
      window.history.replaceState(window.history.state, "", url);
    },
    [key],
  );

  // Read through a ref so an inline `allowed` array does not re-subscribe the listener on every
  // render, without lying to the dependency linter about what the effect closes over.
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  // Back/forward can land on an entry whose param differs from what is rendered — follow it.
  useEffect(() => {
    const onPopState = () => {
      const value = new URL(window.location.href).searchParams.get(key);
      if (
        value !== null &&
        (allowedRef.current as readonly string[]).includes(value)
      ) {
        setTab(value as T);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [key]);

  return [tab, select];
}

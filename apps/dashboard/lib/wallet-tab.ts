/**
 * The wallet page's tab vocabulary, in a module with NO `"use client"` directive.
 *
 * The page resolves `?tab=` on the server and passes the result down, so the parser has to be
 * callable from a server component. Exporting it from `wallet-tabs.tsx` did not work: that file is
 * a client module, so every one of its exports is a client reference and calling one on the server
 * throws at request time — a failure `tsc` cannot see, because the types are perfectly valid.
 */
export const WALLET_TABS = ["overview", "credits", "wallet"] as const;

export type WalletTab = (typeof WALLET_TABS)[number];

/** Narrow an untrusted `?tab=` value. Anything unknown yields null so the caller picks a default. */
export function parseWalletTab(value: string | undefined): WalletTab | null {
  return WALLET_TABS.includes(value as WalletTab) ? (value as WalletTab) : null;
}

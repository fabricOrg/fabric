import { QueryProvider } from "@app/ui/components/ui/query-provider";
import { Toaster } from "@app/ui/components/ui/sonner";
import { TooltipProvider } from "@app/ui/components/ui/tooltip";
import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

/**
 * Fabric Dev Portal — root layout. Same self-hosted brand faces as the dashboard (next/font/local →
 * the CSS vars @app/ui/theme.css consumes). No webfont CDN. Distinct app, same customer realm.
 */
const clash = localFont({
  src: [
    { path: "./fonts/clash-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/clash-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/clash-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-clash",
  display: "swap",
});
const inter = localFont({
  src: [
    { path: "./fonts/inter-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/inter-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});
const jbm = localFont({
  src: [
    { path: "./fonts/jbm-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jbm-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-jbm",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fabric Dev Portal",
  description:
    "API keys, reference, webhooks, and request logs for the Fabric API.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${clash.variable} ${inter.variable} ${jbm.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </QueryProvider>
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}

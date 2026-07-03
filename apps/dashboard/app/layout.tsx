import { Toaster } from "@app/ui/components/ui/sonner";
import { TooltipProvider } from "@app/ui/components/ui/tooltip";
import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

/**
 * Fabric — customer dashboard root layout. Self-hosts the three brand faces via next/font/local and
 * exposes them as the CSS variables @app/ui/theme.css consumes (--font-clash / --font-inter /
 * --font-jbm → --font-display / --font-sans / --font-mono). No webfont CDN (white-label + offline).
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
  title: "Fabric",
  description: "Send SMS and manage your wallet on Fabric.",
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
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}

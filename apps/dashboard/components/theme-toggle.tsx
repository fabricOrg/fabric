"use client";

import { Button } from "@app/ui/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/**
 * Light/dark toggle. Icons swap via CSS `dark:` (SSR-safe, no hydration flash); the click reads
 * resolvedTheme (post-mount) to flip. Root <html> has suppressHydrationWarning for next-themes.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="block dark:hidden" />
    </Button>
  );
}

"use client";

import { Button } from "@app/ui/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * Light/dark toggle. Icons swap via CSS `dark:` (SSR-safe, no hydration flash); the click reads
 * resolvedTheme (post-mount) to flip. Root <html> has suppressHydrationWarning for next-themes.
 *
 * The LABEL could not follow the icons, and that was the one thing here that was not SSR-safe: the
 * server has no idea which theme is stored, so `resolvedTheme` was undefined there and resolved on the
 * client, and the differing `aria-label` was the source of the dashboard's standing hydration error.
 * Until mounted the label says what the control DOES rather than which way it will go — true in either
 * theme — and it sharpens once the theme is actually known.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={
        mounted
          ? isDark
            ? "Switch to light theme"
            : "Switch to dark theme"
          : "Toggle theme"
      }
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="block dark:hidden" />
    </Button>
  );
}

"use client";

import { Button } from "@app/ui/components/ui/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Copy-to-clipboard icon button with feedback — swaps to a check for ~1.2s and toasts, so a copy
 * never happens silently.
 */
export function CopyButton({
  value,
  toastLabel = "Copied to clipboard",
  ariaLabel = "Copy",
  className,
}: {
  value: string;
  toastLabel?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(toastLabel);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      className={className}
      onClick={copy}
      aria-label={copied ? "Copied" : ariaLabel}
    >
      {copied ? <Check className="text-emerald-500" /> : <Copy />}
    </Button>
  );
}

"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import { Input } from "@app/ui/components/ui/input";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canSeeNavCommand, navCommands } from "@/lib/nav";

/**
 * ⌘K / Ctrl-K command palette (keyboard-first navigation — Linear precedent, DASHBOARD-UX-REFERENCE
 * Q-2). Built on shadcn Dialog + Input (no cmdk dependency) over navCommands, the single source of
 * truth shared with the sidebar. Type to filter, ↑/↓ to move, Enter to go, Esc to close — no trap.
 */
const OPEN_EVENT = "fabric:command-menu";

export function CommandMenu({
  permissions,
  role,
}: {
  permissions: readonly string[];
  role: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Only destinations the member can actually reach — mirrors the sidebar gating.
  const commands = useMemo(
    () => navCommands.filter((c) => canSeeNavCommand(c, { permissions, role })),
    [permissions, role],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
    );
  }, [query, commands]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[active];
      if (target) go(target.href);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          {/* Radix Dialog moves focus to the first focusable element (this input) on open. */}
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Jump to…"
            className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            aria-label="Search destinations"
          />
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </p>
          ) : (
            results.map((c, i) => (
              <button
                type="button"
                key={c.href}
                onClick={() => go(c.href)}
                onMouseMove={() => setActive(i)}
                data-active={i === active || undefined}
                className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm data-[active]:bg-accent data-[active]:text-accent-foreground"
              >
                <c.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1">{c.title}</span>
                <span className="text-xs text-muted-foreground">{c.group}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Topbar affordance that opens the palette (mouse users); keyboard users press ⌘K. */
export function CommandMenuTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="Open command menu"
    >
      <Search className="size-4" />
      <span className="hidden sm:inline">Jump to…</span>
      <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
        ⌘K
      </kbd>
    </button>
  );
}

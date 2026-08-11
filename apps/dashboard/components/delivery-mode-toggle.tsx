"use client";

import { type DeliveryMode, parseApiError } from "@app/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@app/ui/components/ui/alert-dialog";
import { cn } from "@app/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Radio, Smartphone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  getMessagingSettings,
  updateMessagingMode,
} from "@/lib/client/dashboard-api";
import { toastApiError } from "@/lib/error-toast";

/**
 * A heading and a next step per refusal reason. The BODY is not here on purpose — it is whatever the
 * API said.
 *
 * Hardcoding a cause per error code is what produced the bug this replaces: `live_provider_not_ready`
 * has TWO causes, a missing carrier and a transient control-plane failure whose server message is
 * "Try again shortly", and a fixed string asserted the permanent one for both. The server already
 * knows which fired, so the client states the consequence and the next step and quotes the reason.
 *
 * `note` is the part the API cannot know: what the customer should do next in THIS product.
 */
const BLOCK_COPY = {
  sender: {
    title: "Sender ID required",
    note: "Register a sender ID and wait for carrier approval before switching from the virtual phone.",
    action: { label: "Open Sender IDs", href: "/senders" },
  },
  locked: {
    title: "Go-live required",
    note: "Live API keys and carrier delivery unlock once the compliance review passes. Virtual delivery stays active until then.",
    action: { label: "Review go-live", href: "/go-live" },
  },
  carrier: {
    // This code covers BOTH a missing carrier and a transient control-plane failure, so the note must
    // hold for either — asserting the permanent one would contradict the server's "try again shortly".
    // The sender ID is a real prerequisite either way, and it is the part the customer owns.
    title: "Live delivery isn't available yet",
    note: "An approved sender ID is also required before live delivery works. Virtual delivery keeps working meanwhile, and nothing you send is lost.",
    action: { label: "Open Sender IDs", href: "/senders" },
  },
} as const satisfies Record<
  string,
  { title: string; note: string; action: { label: string; href: string } }
>;

type BlockKind = keyof typeof BLOCK_COPY;

/** Which refusal each API error code maps to. Anything absent is a toast, not a dialog. */
const BLOCK_KIND_BY_CODE: Record<string, BlockKind | undefined> = {
  live_delivery_not_ready: "sender",
  delivery_mode_locked: "locked",
  live_provider_not_ready: "carrier",
};

function BlockDialogBody({
  block,
}: {
  block: { kind: BlockKind; reason: string };
}) {
  const copy = BLOCK_COPY[block.kind];
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogMedia>
          <AlertTriangle />
        </AlertDialogMedia>
        <AlertDialogTitle>{copy.title}</AlertDialogTitle>
        <AlertDialogDescription>
          {/* The API's own sentence first — it is the only party that knows WHICH cause fired. */}
          {block.reason}
          <span className="mt-2 block">{copy.note}</span>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep virtual mode</AlertDialogCancel>
        {/* asChild + Link, not window.location: a full reload here throws away the query cache and
            re-runs the whole RSC render for a route this app already owns. */}
        <AlertDialogAction asChild>
          <Link href={copy.action.href}>{copy.action.label}</Link>
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

export function DeliveryModeToggle() {
  const queryClient = useQueryClient();
  // Three DISTINCT reasons live delivery can be refused, kept distinct. `delivery_mode_locked` (the
  // workspace has not gone live) and `live_provider_not_ready` (no live carrier) used to collapse into
  // one state whose copy asserted BOTH causes — so a workspace that HAD completed go-live was told it
  // was not approved. The reason string travels with the kind so the body can quote the server.
  const [liveBlock, setLiveBlock] = useState<{
    kind: BlockKind;
    reason: string;
  } | null>(null);
  // Open is tracked separately so the content survives the dialog's 200ms exit animation. Nulling the
  // block on close emptied the panel first and faded a blank box out afterwards.
  const [blockOpen, setBlockOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["messaging-settings"],
    queryFn: getMessagingSettings,
  });
  const mutation = useMutation({
    mutationFn: updateMessagingMode,
    onSuccess: (settings) => {
      queryClient.setQueryData(["messaging-settings"], settings);
    },
    onError: (error) => {
      const parsed = parseApiError(error);
      const kind = BLOCK_KIND_BY_CODE[parsed.code];
      if (!kind) {
        toastApiError(error);
        return;
      }
      setLiveBlock({ kind, reason: parsed.message });
      setBlockOpen(true);
    },
  });
  const settings = settingsQuery.data;

  function select(mode: DeliveryMode) {
    if (!settings || settings.delivery_mode === mode || mutation.isPending)
      return;
    mutation.mutate(mode);
  }

  if (!settings)
    return (
      <div
        className="hidden h-9 w-40 animate-pulse rounded-md bg-muted sm:block"
        role="status"
        aria-label="Loading delivery mode"
      />
    );

  return (
    <>
      <div
        className="inline-flex h-9 rounded-md border bg-muted/40 p-1"
        role="radiogroup"
        aria-label="Delivery mode"
        title={settings.reason ?? "Workspace delivery mode"}
      >
        <ModeButton
          label="Virtual"
          icon={<Smartphone />}
          selected={settings.delivery_mode === "virtual"}
          disabled={mutation.isPending}
          onClick={() => select("virtual")}
        />
        <ModeButton
          label="Live"
          icon={<Radio />}
          selected={settings.delivery_mode === "live"}
          disabled={mutation.isPending}
          onClick={() => select("live")}
        />
      </div>
      <AlertDialog open={blockOpen} onOpenChange={setBlockOpen}>
        <AlertDialogContent>
          {liveBlock ? <BlockDialogBody block={liveBlock} /> : null}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ModeButton({
  label,
  icon,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        selected
          ? "bg-background font-medium shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="hidden sm:inline-flex">
        {selected ? <Check className="size-3.5" /> : icon}
      </span>
      <span className="hidden md:inline">{label}</span>
      <span className="sr-only md:hidden">{label}</span>
    </button>
  );
}

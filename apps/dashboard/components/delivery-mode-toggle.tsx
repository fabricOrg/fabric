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
import { useState } from "react";
import {
  getMessagingSettings,
  updateMessagingMode,
} from "@/lib/client/dashboard-api";
import { toastApiError } from "@/lib/error-toast";

/**
 * One entry per refusal reason. Each names ONLY its own cause, because the previous single message
 * asserted every cause at once and was therefore wrong about at least one of them every time it
 * appeared. No vendor is named either: the carrier is control-plane config and naming one in product
 * copy makes the sentence false the moment routing changes.
 */
const BLOCK_COPY = {
  sender: {
    title: "Sender ID required",
    description:
      "Live delivery needs at least one approved sender ID. Register a sender ID and wait for carrier approval before switching from the virtual phone.",
    action: { label: "Open Sender IDs", href: "/senders" },
  },
  locked: {
    title: "Go-live required",
    description:
      "This workspace hasn't completed go-live. Live API keys and carrier delivery unlock once the compliance review passes. Virtual delivery stays active until then.",
    action: { label: "Review go-live", href: "/go-live" },
  },
  carrier: {
    title: "No live SMS carrier connected",
    description:
      "This workspace has gone live, but no live SMS carrier is connected yet, so there is nothing to route real messages through. Connecting one is a platform operation — contact support to have it enabled. Virtual delivery keeps working meanwhile, and nothing you send is lost.",
    action: null,
  },
} as const satisfies Record<
  string,
  {
    title: string;
    description: string;
    action: { label: string; href: string } | null;
  }
>;

function BlockDialogBody({
  copy,
}: {
  copy: (typeof BLOCK_COPY)[keyof typeof BLOCK_COPY];
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogMedia>
          <AlertTriangle />
        </AlertDialogMedia>
        <AlertDialogTitle>{copy.title}</AlertDialogTitle>
        <AlertDialogDescription>{copy.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep virtual mode</AlertDialogCancel>
        {/* No action for `carrier`: connecting one is a platform operation, not something this
            customer can go and do, and a button leading nowhere useful is worse than none. */}
        {copy.action ? (
          <AlertDialogAction
            onClick={() => {
              window.location.href = copy.action.href;
            }}
          >
            {copy.action.label}
          </AlertDialogAction>
        ) : null}
      </AlertDialogFooter>
    </>
  );
}

export function DeliveryModeToggle() {
  const queryClient = useQueryClient();
  // Three DISTINCT reasons live delivery can be refused, kept distinct. `delivery_mode_locked` (the
  // workspace has not gone live) and `live_provider_not_ready` (no live SMS carrier is connected) used
  // to collapse into one state whose copy asserted BOTH causes — so a workspace that had completed
  // go-live was told it was not approved, directly contradicting the "This workspace is live" banner
  // on the page the dialog links to. Different cause, different remedy, different owner.
  const [liveBlock, setLiveBlock] = useState<
    "sender" | "locked" | "carrier" | null
  >(null);

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
      const code = parseApiError(error).code;
      if (code === "live_delivery_not_ready") {
        setLiveBlock("sender");
      } else if (code === "delivery_mode_locked") {
        setLiveBlock("locked");
      } else if (code === "live_provider_not_ready") {
        setLiveBlock("carrier");
      } else {
        toastApiError(error);
      }
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
      <AlertDialog
        open={liveBlock !== null}
        onOpenChange={(open) => !open && setLiveBlock(null)}
      >
        <AlertDialogContent>
          {liveBlock ? <BlockDialogBody copy={BLOCK_COPY[liveBlock]} /> : null}
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

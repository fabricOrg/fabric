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

export function DeliveryModeToggle() {
  const queryClient = useQueryClient();
  const [liveBlock, setLiveBlock] = useState<"sender" | "workspace" | null>(
    null,
  );

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
      } else if (
        code === "delivery_mode_locked" ||
        code === "live_provider_not_ready"
      ) {
        setLiveBlock("workspace");
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
          <AlertDialogHeader>
            <AlertDialogMedia>
              <AlertTriangle />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {liveBlock === "sender"
                ? "Sender ID required"
                : "Live delivery is not ready"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {liveBlock === "sender"
                ? "Live delivery needs at least one approved sender ID. Register a sender ID and wait for carrier approval before switching from the virtual phone."
                : "Carrier delivery is unavailable until the workspace is approved and the Arkesel production connection is configured. Virtual delivery remains active."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep virtual mode</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.location.href =
                  liveBlock === "sender" ? "/senders" : "/go-live";
              }}
            >
              {liveBlock === "sender" ? "Open Sender IDs" : "Review go-live"}
            </AlertDialogAction>
          </AlertDialogFooter>
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

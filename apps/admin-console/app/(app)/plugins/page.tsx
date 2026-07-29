"use client";

import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import {
  CreditCard,
  Mail,
  MessageCircle,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfigurePluginDialog } from "@/components/forms/configure-plugin-dialog";
import {
  CAPABILITIES,
  type Capability,
  createLiveInstance,
  getPlugins,
  type PluginInstance,
  updatePlugin,
} from "@/lib/client/plugins-api";
import { toastApiError } from "@/lib/error-toast";

const META: Record<
  Capability,
  { label: string; blurb: string; icon: typeof Send }
> = {
  sms: {
    label: "SMS",
    icon: Send,
    blurb: "Route SMS through one or more providers with automatic failover.",
  },
  email: {
    label: "Email",
    icon: Mail,
    blurb: "Transactional Email through AWS SES with signed delivery events.",
  },
  whatsapp: {
    label: "WhatsApp",
    icon: MessageCircle,
    blurb: "Business messaging via the WhatsApp Cloud API.",
  },
  payment: {
    label: "Payments",
    icon: CreditCard,
    blurb: "Collect and disburse over local rails (mobile-money, cards).",
  },
  identity: {
    label: "Identity",
    icon: ShieldCheck,
    blurb: "Single sign-on and verification.",
  },
};

export default function PluginsPage() {
  const [instances, setInstances] = useState<PluginInstance[] | null>(null);
  const [configuring, setConfiguring] = useState<PluginInstance | null>(null);

  useEffect(() => {
    let live = true;
    getPlugins()
      .then((r) => {
        if (live) setInstances(r);
      })
      .catch((e) => {
        if (!live) return;
        setInstances([]);
        toastApiError(e);
      });
    return () => {
      live = false;
    };
  }, []);

  /** Re-read after a credential install — the fingerprint is server-derived, not guessable here. */
  async function reload() {
    try {
      setInstances(await getPlugins());
    } catch (e) {
      toastApiError(e);
    }
  }

  async function act(
    instance: PluginInstance,
    action: "enable" | "disable" | "make-default" | "activate-live",
  ) {
    try {
      const updated = await updatePlugin({ id: instance.id, action });
      setInstances((prev) =>
        (prev ?? []).map((i) => {
          if (i.id === updated.id) return updated;
          if (action === "make-default" && i.capability === updated.capability)
            return { ...i, isDefault: false };
          return i;
        }),
      );
      if (action === "activate-live") {
        toast.success(`${updated.label} is live`, {
          description:
            "Sends now reach a real carrier. Status stays 'available' until a message actually goes out.",
        });
      }
    } catch (e) {
      toastApiError(e);
    }
  }

  async function addLive(row: PluginInstance) {
    try {
      await createLiveInstance({
        vendor: row.vendor,
        capability: row.capability,
        label: `${row.label} (live)`,
      });
      await reload();
    } catch (e) {
      toastApiError(e);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Plugins
        </h1>
        <p className="text-sm text-muted-foreground">
          Platform providers. Enable instances, pick a default, add fallbacks
          per capability — the product routes through whatever is enabled here.
          No vendor lock-in.
        </p>
      </div>

      {instances === null ? (
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        CAPABILITIES.map((cap) => {
          const rows = instances.filter((i) => i.capability === cap);
          if (rows.length === 0) return null;
          const meta = META[cap];
          const Icon = meta.icon;
          return (
            <Card key={cap}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4 text-muted-foreground" />
                  {meta.label}
                </CardTitle>
                <CardDescription>{meta.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col divide-y">
                {rows.map((row) => (
                  <PluginRow
                    key={row.id}
                    row={row}
                    hasLiveSibling={rows.some(
                      (i) => i.vendor === row.vendor && i.mode === "live",
                    )}
                    onAct={act}
                    onAddLive={() => addLive(row)}
                    onConfigure={() => setConfiguring(row)}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })
      )}

      <ConfigurePluginDialog
        instance={configuring}
        open={configuring !== null}
        onOpenChange={(open) => !open && setConfiguring(null)}
        onConfigured={reload}
      />
    </div>
  );
}

function PluginRow({
  row,
  hasLiveSibling,
  onAct,
  onAddLive,
  onConfigure,
}: {
  row: PluginInstance;
  hasLiveSibling: boolean;
  onAct: (
    i: PluginInstance,
    a: "enable" | "disable" | "make-default" | "activate-live",
  ) => void;
  onAddLive: () => void;
  onConfigure: () => void;
}) {
  const configured = row.credential_fingerprint !== null;
  const isLive = row.mode === "live";
  // A live instance without credentials cannot dispatch, so the control is disabled WITH the reason
  // rather than letting staff click into a `credentials_required` error.
  const activateBlockedReason = configured
    ? null
    : "Install credentials before activating live delivery.";
  return (
    <div className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.vendor}</span>
          {row.isDefault ? (
            <Badge
              variant="outline"
              className="border-transparent bg-primary/12 text-primary"
            >
              Primary
            </Badge>
          ) : row.enabled ? (
            <Badge
              variant="outline"
              className="border-transparent bg-muted text-muted-foreground"
            >
              Fallback
            </Badge>
          ) : null}
          {row.mode ? (
            <Badge
              variant="outline"
              className={
                row.mode === "live"
                  ? "border-transparent bg-success/12 text-success"
                  : "border-transparent bg-warning/15 text-warning-strong"
              }
            >
              {row.mode}
            </Badge>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {/* `connected` is EARNED by a real dispatch (ADR-0011 §6) — never by enabling a toggle,
              so it must not be worded as if the toggle proved anything. */}
          {row.status === "connected"
            ? "Connected — a message has actually gone out"
            : row.status === "error"
              ? "Last send failed"
              : configured
                ? "Credentials installed · not yet proven"
                : "No credentials"}
          {configured ? ` · ${row.credential_fingerprint}` : ""}
          {row.region ? ` · ${row.region}` : ""}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {!isLive && !hasLiveSibling ? (
          <Button size="sm" variant="ghost" onClick={onAddLive}>
            Add live
          </Button>
        ) : null}
        {row.enabled && !row.isDefault ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onAct(row, "make-default")}
          >
            Make primary
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onConfigure}>
          {configured ? "Rotate key" : "Configure"}
        </Button>
        {isLive && !row.enabled ? (
          <Button
            size="sm"
            disabled={activateBlockedReason !== null}
            title={activateBlockedReason ?? undefined}
            onClick={() => onAct(row, "activate-live")}
          >
            Activate live
          </Button>
        ) : (
          <Button
            size="sm"
            variant={row.enabled ? "ghost" : "default"}
            onClick={() => onAct(row, row.enabled ? "disable" : "enable")}
          >
            {row.enabled ? "Disable" : "Enable"}
          </Button>
        )}
      </div>
    </div>
  );
}

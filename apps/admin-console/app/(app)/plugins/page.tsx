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
import { CreditCard, MessageCircle, Send, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfigurePluginDialog } from "@/components/plugins/configure-plugin-dialog";
import {
  CAPABILITIES,
  type Capability,
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

  async function act(
    instance: PluginInstance,
    action: "enable" | "disable" | "make-default",
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
    } catch (e) {
      toastApiError(e);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
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
                    onAct={act}
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
      />
    </div>
  );
}

function PluginRow({
  row,
  onAct,
  onConfigure,
}: {
  row: PluginInstance;
  onAct: (i: PluginInstance, a: "enable" | "disable" | "make-default") => void;
  onConfigure: () => void;
}) {
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
          {row.status === "connected" ? "Connected" : "Not configured"}
          {row.region ? ` · ${row.region}` : ""}
        </span>
      </div>

      <div className="flex items-center gap-2">
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
          Configure
        </Button>
        <Button
          size="sm"
          variant={row.enabled ? "ghost" : "default"}
          onClick={() => onAct(row, row.enabled ? "disable" : "enable")}
        >
          {row.enabled ? "Disable" : "Enable"}
        </Button>
      </div>
    </div>
  );
}

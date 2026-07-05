"use client";

import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { cn } from "@app/ui/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  saveChannels,
  type VerifyChannel,
  type VerifyChannelName,
} from "@/lib/client/verify-api";
import { toastApiError } from "@/lib/error-toast";

const CHANNEL_META: Record<
  VerifyChannelName,
  { label: string; icon: LucideIcon; hint: string }
> = {
  sms: { label: "SMS", icon: MessageSquare, hint: "One-time code by text" },
  voice: { label: "Voice", icon: Phone, hint: "Spoken code via call" },
  whatsapp: {
    label: "WhatsApp",
    icon: MessageCircle,
    hint: "Code via WhatsApp",
  },
  email: { label: "Email", icon: Mail, hint: "Code by email" },
};

const byOrder = (a: VerifyChannel, b: VerifyChannel) => a.order - b.order;
const RANK = ["1st", "2nd", "3rd", "4th"];

export function ChannelConfigCard({
  channels,
  onSaved,
}: {
  channels: readonly VerifyChannel[];
  onSaved: (channels: VerifyChannel[]) => void;
}) {
  const [draft, setDraft] = useState<VerifyChannel[]>(() =>
    [...channels].sort(byOrder),
  );
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify([...channels].sort(byOrder)),
    [draft, channels],
  );

  // Failover rank among ENABLED channels (order can carry gaps once a channel is turned off).
  const enabledRank = useMemo(() => {
    const map = new Map<VerifyChannelName, number>();
    draft
      .filter((c) => c.enabled)
      .sort(byOrder)
      .forEach((c, i) => {
        map.set(c.channel, i);
      });
    return map;
  }, [draft]);

  function toggle(channel: VerifyChannelName) {
    setDraft((prev) =>
      prev.map((c) =>
        c.channel === channel ? { ...c, enabled: !c.enabled } : c,
      ),
    );
  }

  // Swap failover `order` with the adjacent row so priority is reorderable without a drag lib.
  function move(index: number, dir: -1 | 1) {
    setDraft((prev) => {
      const sorted = [...prev].sort(byOrder);
      const target = sorted[index];
      const swap = sorted[index + dir];
      if (!target || !swap) return prev;
      const nextOrder = swap.order;
      const prevOrder = target.order;
      return prev.map((c) => {
        if (c.channel === target.channel) return { ...c, order: nextOrder };
        if (c.channel === swap.channel) return { ...c, order: prevOrder };
        return c;
      });
    });
  }

  async function save() {
    setSaving(true);
    const snapshot = [...channels].sort(byOrder);
    const next = [...draft].sort(byOrder);
    onSaved(next); // optimistic: lift state up immediately
    toast.success("Channel routing saved");
    try {
      const confirmed = await saveChannels(next);
      onSaved([...confirmed].sort(byOrder));
    } catch (payload) {
      setDraft(snapshot); // revert on failure
      onSaved(snapshot);
      toastApiError(payload);
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...draft].sort(byOrder);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="font-display">Channels &amp; failover</CardTitle>
        <CardDescription>
          One API, many channels. If the top channel doesn&apos;t verify, Fabric
          falls back down this list automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2">
        <ul className="flex flex-col gap-2">
          {sorted.map((c, i) => {
            const meta = CHANNEL_META[c.channel];
            const Icon = meta.icon;
            const rank = enabledRank.get(c.channel);
            return (
              <li
                key={c.channel}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3",
                  !c.enabled && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-md",
                    c.enabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{meta.label}</span>
                    {c.enabled && rank !== undefined ? (
                      <Badge
                        variant="outline"
                        className="border-transparent bg-primary/10 font-mono text-primary tabular-nums"
                      >
                        {RANK[rank] ?? `#${rank + 1}`}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-transparent bg-muted text-muted-foreground"
                      >
                        Off
                      </Badge>
                    )}
                  </div>
                  <span className="truncate text-xs text-muted-foreground">
                    {meta.hint}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`Move ${meta.label} up in failover order`}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={i === sorted.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`Move ${meta.label} down in failover order`}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant={c.enabled ? "outline" : "default"}
                    className="ml-1 w-20"
                    onClick={() => toggle(c.channel)}
                  >
                    {c.enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}

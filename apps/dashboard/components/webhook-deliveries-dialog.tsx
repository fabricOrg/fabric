"use client";

import type { WebhookDeliveryDto, WebhookEndpointDto } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import { useEffect, useState } from "react";
import { toastApiError } from "@/lib/error-toast";

export function WebhookDeliveriesDialog({
  endpoint,
  open,
  onOpenChange,
  onChanged,
}: {
  endpoint: WebhookEndpointDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [deliveries, setDeliveries] = useState<WebhookDeliveryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [replaying, setReplaying] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/webhooks/${encodeURIComponent(endpoint.id)}/deliveries`)
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          deliveries?: WebhookDeliveryDto[];
        } | null;
        if (!response.ok) {
          toastApiError(payload);
          return;
        }
        setDeliveries(payload?.deliveries ?? []);
      })
      .catch(() => toastApiError(null))
      .finally(() => setLoading(false));
  }, [endpoint.id, open]);

  async function replay(delivery: WebhookDeliveryDto) {
    setReplaying(delivery.id);
    try {
      const response = await fetch(
        `/api/webhooks/${encodeURIComponent(endpoint.id)}/deliveries/${encodeURIComponent(delivery.id)}/replay`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => null)) as {
        delivery?: WebhookDeliveryDto;
      } | null;
      if (!response.ok || !payload?.delivery) {
        toastApiError(payload);
        return;
      }
      setDeliveries((current) =>
        current.map((item) =>
          item.id === delivery.id ? (payload.delivery ?? item) : item,
        ),
      );
      onChanged();
    } catch {
      toastApiError(null);
    } finally {
      setReplaying(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Webhook deliveries</DialogTitle>
          <DialogDescription className="break-all">
            Recent events sent to {endpoint.url}. Event IDs remain stable across
            retries.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading deliveries…</p>
        ) : null}
        {!loading && deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deliveries for this endpoint yet.
          </p>
        ) : null}
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {deliveries.map((delivery) => (
            <div
              key={delivery.id}
              className="flex items-center justify-between gap-4 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{delivery.state}</Badge>
                  <span className="text-sm">{delivery.event_type}</span>
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {delivery.event_id} · {delivery.attempts} attempt
                  {delivery.attempts === 1 ? "" : "s"}
                </p>
                {delivery.last_error_category ? (
                  <p className="text-xs text-destructive">
                    {delivery.last_error_category}
                    {delivery.last_http_status
                      ? ` (${delivery.last_http_status})`
                      : ""}
                  </p>
                ) : null}
              </div>
              {delivery.state === "dead" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={replaying === delivery.id}
                  onClick={() => replay(delivery)}
                >
                  {replaying === delivery.id ? "Replaying…" : "Replay"}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

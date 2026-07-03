"use client";

import type { WebhookEndpoint, WebhookEventType } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@app/ui/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { Check, Copy, Eye, EyeOff, TriangleAlert, Webhook } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toastApiError } from "@/lib/error-toast";
import { listWebhooks, type Scenario, testWebhook } from "@/lib/mock-api";
import { formatTimestamp } from "@/lib/time";

const EVENT_TYPES: readonly WebhookEventType[] = [
  "message.sent",
  "message.delivered",
  "message.undelivered",
  "message.failed",
  "message.inbound",
];

function SigningSecret({ secret }: { secret: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
        {shown ? secret : "whsec_••••••••••"}
      </code>
      <Button
        variant="ghost"
        size="icon"
        aria-label={shown ? "Hide secret" : "Reveal secret"}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? <EyeOff /> : <Eye />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copy signing secret"
        onClick={() => {
          navigator.clipboard?.writeText(secret);
          setCopied(true);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function WebhooksInner() {
  const [rows, setRows] = useState<WebhookEndpoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorReqId, setErrorReqId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [testEndpoint, setTestEndpoint] = useState("");
  const [testEvent, setTestEvent] =
    useState<WebhookEventType>("message.delivered");
  const [testing, setTesting] = useState(false);

  const stateParam = useSearchParams().get("state");
  const scenario: Scenario =
    stateParam === "empty" || stateParam === "error" ? stateParam : "populated";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` is a manual refetch trigger, not read in the effect
  useEffect(() => {
    let live = true;
    setLoading(true);
    setErrorReqId(null);
    listWebhooks(scenario)
      .then((data) => {
        if (!live) return;
        setRows([...data]);
        setTestEndpoint(data[0]?.id ?? "");
      })
      .catch((envelope) => {
        if (!live) return;
        setErrorReqId(toastApiError(envelope).requestId ?? null);
        setRows(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [reload, scenario]);

  async function sendTest() {
    setTesting(true);
    try {
      const res = await testWebhook(testEndpoint, testEvent);
      const { toast } = await import("sonner");
      toast.success(`Test event delivered (${res.statusCode})`);
    } catch (envelope) {
      toastApiError(envelope);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Webhooks
        </h1>
        <p className="text-sm text-muted-foreground">
          Endpoints we POST delivery reports and inbound messages to. Signed
          with a per-endpoint secret; test against a registered endpoint below.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : errorReqId !== null || rows === null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Couldn't load webhooks</EmptyTitle>
            <EmptyDescription>
              Please try again.{" "}
              {errorReqId ? `Contact support with ${errorReqId}.` : ""}
            </EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" onClick={() => setReload((x) => x + 1)}>
            Retry
          </Button>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Webhook />
            </EmptyMedia>
            <EmptyTitle>No endpoints yet</EmptyTitle>
            <EmptyDescription>
              Register a URL (via the API) to receive signed delivery reports
              and inbound messages.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {rows.map((e) => (
              <Card key={e.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3 text-base">
                    <span className="font-mono text-sm break-all">{e.url}</span>
                    {e.status === "active" ? (
                      <Badge className="bg-success/12 text-success border-transparent">
                        Active
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        Disabled
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <div className="flex flex-wrap gap-1">
                    {e.events.map((ev) => (
                      <Badge
                        key={ev}
                        variant="outline"
                        className="font-mono text-xs"
                      >
                        {ev}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Signing secret · added {formatTimestamp(e.createdAt)}
                    </span>
                    <SigningSecret secret={e.signingSecret} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Test a webhook</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="test-endpoint">Endpoint</FieldLabel>
                <Select value={testEndpoint} onValueChange={setTestEndpoint}>
                  <SelectTrigger id="test-endpoint">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {rows.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.url}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Sends only to one of your registered endpoints — never a
                  free-form URL.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="test-event">Event type</FieldLabel>
                <Select
                  value={testEvent}
                  onValueChange={(v) => setTestEvent(v as WebhookEventType)}
                >
                  <SelectTrigger id="test-event">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((ev) => (
                      <SelectItem key={ev} value={ev}>
                        {ev}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button
                className="self-start"
                onClick={sendTest}
                disabled={testing || !testEndpoint}
              >
                {testing ? "Sending…" : "Send test event"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export default function WebhooksPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl p-6">Loading…</div>}>
      <WebhooksInner />
    </Suspense>
  );
}

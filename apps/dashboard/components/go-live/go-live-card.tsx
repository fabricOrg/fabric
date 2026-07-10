"use client";

import type { GoLiveStatus } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Input } from "@app/ui/components/ui/input";
import { Label } from "@app/ui/components/ui/label";
import { Textarea } from "@app/ui/components/ui/textarea";
import { BadgeCheck, Clock, Rocket, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toastApiError } from "@/lib/error-toast";

async function bff(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

export function GoLiveCard({
  canRequest,
  isSandbox,
}: {
  canRequest: boolean;
  isSandbox: boolean;
}) {
  const [status, setStatus] = useState<GoLiveStatus | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [registration, setRegistration] = useState("");
  const [useCase, setUseCase] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    bff("/api/dashboard/go-live")
      .then((s) => {
        if (live) setStatus(s as GoLiveStatus);
      })
      .catch(() => {
        if (live) {
          setStatus({
            status: "none",
            decided_reason: null,
            requested_at: null,
          });
        }
      });
    return () => {
      live = false;
    };
  }, []);

  async function submit() {
    setBusy(true);
    try {
      await bff("/api/dashboard/go-live", {
        method: "POST",
        body: JSON.stringify({
          business_name: businessName.trim(),
          ...(registration.trim()
            ? { registration_number: registration.trim() }
            : {}),
          use_case: useCase.trim(),
        }),
      });
      setStatus({
        status: "pending",
        decided_reason: null,
        requested_at: new Date().toISOString(),
      });
    } catch (payload) {
      toastApiError(payload);
    } finally {
      setBusy(false);
    }
  }

  if (!isSandbox) {
    return (
      <Alert>
        <BadgeCheck className="size-4" />
        <AlertTitle>This workspace is live</AlertTitle>
        <AlertDescription>
          Live API keys and real delivery are enabled.
        </AlertDescription>
      </Alert>
    );
  }
  if (status === null) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Loading request status…
        </CardContent>
      </Card>
    );
  }
  if (status.status === "pending") {
    return (
      <Alert>
        <Clock className="size-4" />
        <AlertTitle>Request under review</AlertTitle>
        <AlertDescription>
          Our team is reviewing your go-live request. You&apos;ll keep full
          sandbox access meanwhile.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {status.status === "rejected" ? (
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertTitle>Previous request declined</AlertTitle>
          <AlertDescription>
            {status.decided_reason ??
              "See the reason from our team, adjust, and resubmit."}
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="size-4" /> Request go-live
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canRequest ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gl-business">Registered business name</Label>
                <Input
                  id="gl-business"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Acme Fintech Ltd"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gl-reg">Registration number (optional)</Label>
                <Input
                  id="gl-reg"
                  value={registration}
                  onChange={(e) => setRegistration(e.target.value)}
                  placeholder="CS123456789"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gl-usecase">
                  What will you send, and to whom?
                </Label>
                <Textarea
                  id="gl-usecase"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  placeholder="OTP and transactional notifications to our checkout customers in Ghana…"
                  rows={4}
                />
              </div>
              <Button
                onClick={submit}
                disabled={
                  busy ||
                  businessName.trim().length < 2 ||
                  useCase.trim().length < 10
                }
                className="self-start"
              >
                {busy ? "Submitting…" : "Submit for review"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only a workspace owner or admin can request go-live.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

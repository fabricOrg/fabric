"use client";

import type { SubjectSummary } from "@app/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@app/ui/components/ui/alert-dialog";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Input } from "@app/ui/components/ui/input";
import { Label } from "@app/ui/components/ui/label";
import { useState } from "react";
import { toast } from "sonner";

type Lookup = SubjectSummary | { found: false };

function isFound(value: Lookup): value is SubjectSummary {
  return !("found" in value);
}

/**
 * The DSR trigger. Look up first (kinds only — never the values, so answering a request cannot leak
 * PII into a screenshot), then erase behind an explicit confirmation. Erasure is irreversible, so the
 * confirm step states that in words rather than relying on the operator to know it.
 */
export function EraseSubjectPanel({ canErase }: { canErase: boolean }) {
  const [tenantId, setTenantId] = useState("");
  const [msisdn, setMsisdn] = useState("");
  const [basis, setBasis] = useState("");
  const [result, setResult] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function lookup() {
    setLooking(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(
        `/api/admin/privacy?tenant_id=${encodeURIComponent(tenantId)}&msisdn=${encodeURIComponent(msisdn)}`,
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? "Lookup failed.");
        return;
      }
      setResult(body as Lookup);
    } catch {
      setError("Lookup failed.");
    } finally {
      setLooking(false);
    }
  }

  async function erase() {
    setErasing(true);
    try {
      const response = await fetch("/api/admin/privacy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, msisdn, basis }),
      });
      const body = await response.json();
      if (!response.ok) {
        toast.error(body?.error?.message ?? "Erasure failed.");
        return;
      }
      toast.success("Data subject erased. Their key has been destroyed.");
      setConfirming(false);
      setBasis("");
      await lookup();
    } catch {
      toast.error("Erasure failed.");
    } finally {
      setErasing(false);
    }
  }

  const ready = tenantId.trim().length > 0 && msisdn.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Look up a data subject</CardTitle>
        <CardDescription>
          Search by workspace and phone number. Only the KINDS of data held are
          shown — never the values.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tenant">Workspace id</Label>
            <Input
              id="tenant"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="msisdn">Phone number</Label>
            <Input
              id="msisdn"
              value={msisdn}
              onChange={(event) => setMsisdn(event.target.value)}
              placeholder="+233545227189"
            />
          </div>
        </div>

        <div>
          <Button onClick={lookup} disabled={!ready || looking}>
            {looking ? "Looking up…" : "Look up"}
          </Button>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {result && !isFound(result) ? (
          <p className="text-sm text-muted-foreground">
            This workspace holds no personal data for that number.
          </p>
        ) : null}

        {result && isFound(result) ? (
          <div className="flex flex-col gap-4 rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-sm">
                {result.msisdn_masked}
              </span>
              {result.erased ? (
                <Badge variant="outline">Already erased</Badge>
              ) : (
                <Badge>Data held</Badge>
              )}
              {result.kinds.map((kind) => (
                <Badge key={kind} variant="secondary">
                  {kind}
                </Badge>
              ))}
            </div>

            {result.erased ? (
              <p className="text-sm text-muted-foreground">
                This subject&apos;s key was destroyed. Their data is permanently
                unreadable; the delivery and ledger history remain.
              </p>
            ) : null}

            {!result.erased && canErase ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="basis">Legal basis</Label>
                <Input
                  id="basis"
                  value={basis}
                  onChange={(event) => setBasis(event.target.value)}
                  placeholder="e.g. GDPR Art. 17 erasure request, ticket #1234"
                />
                <p className="text-xs text-muted-foreground">
                  Recorded permanently as proof the request was honoured — long
                  after the data is gone.
                </p>
                <div>
                  <Button
                    variant="destructive"
                    disabled={basis.trim().length < 8}
                    onClick={() => setConfirming(true)}
                  >
                    Erase this data subject
                  </Button>
                </div>
              </div>
            ) : null}

            {!result.erased && !canErase ? (
              <p className="text-sm text-muted-foreground">
                Only staff admins can action an erasure.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase this data subject?</AlertDialogTitle>
            <AlertDialogDescription>
              This destroys the encryption key for{" "}
              {result && isFound(result) ? result.msisdn_masked : "this number"}
              . Their phone number and every message body become permanently
              unreadable — no backup restores them. The wallet ledger and
              delivery history stay intact. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={erasing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void erase();
              }}
              disabled={erasing}
            >
              {erasing ? "Erasing…" : "Erase permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

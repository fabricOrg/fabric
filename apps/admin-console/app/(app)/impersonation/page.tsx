"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { TriangleAlert, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { IMPERSONATION_EVENT } from "@/components/impersonation-banner";
import { TENANTS } from "@/lib/mock-admin";

const WINDOW_MIN = 15;
const OPEN = TENANTS.filter((t) => t.status !== "closed");

export default function ImpersonationPage() {
  const [tenant, setTenant] = useState("");
  const [reason, setReason] = useState("");
  const valid = tenant !== "" && reason.trim().length >= 8;

  function start() {
    // Mock — TODO(BFF): mints a time-boxed, reason-logged ImpersonationClaim in the fe-auth session.
    sessionStorage.setItem(
      "fabric-impersonation",
      JSON.stringify({ tenant, endsAt: Date.now() + WINDOW_MIN * 60_000 }),
    );
    window.dispatchEvent(new Event(IMPERSONATION_EVENT));
    toast.success(
      `Impersonating ${tenant} for ${WINDOW_MIN} min (reason logged)`,
    );
    setReason("");
    setTenant("");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Impersonation
        </h1>
        <p className="text-sm text-muted-foreground">
          Act as a tenant to debug — time-boxed, reason-logged, never silent.
        </p>
      </div>

      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>This is powerful and audited</AlertTitle>
        <AlertDescription>
          A persistent banner shows for the entire {WINDOW_MIN}-minute window,
          the reason is written to the audit log, and it auto-ends. Use only for
          a specific support/debug task.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="size-4" />
            Start a session
          </CardTitle>
          <CardDescription>Both fields are required.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="imp-tenant">Tenant</FieldLabel>
            <Select value={tenant} onValueChange={setTenant}>
              <SelectTrigger id="imp-tenant">
                <SelectValue placeholder="Select a tenant" />
              </SelectTrigger>
              <SelectContent>
                {OPEN.map((t) => (
                  <SelectItem key={t.id} value={t.name}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="imp-reason">Reason (min 8 chars)</FieldLabel>
            <Input
              id="imp-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Debug failed DLR reconciliation, ticket #4821"
            />
          </Field>
          <Button className="self-start" disabled={!valid} onClick={start}>
            Start impersonation
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

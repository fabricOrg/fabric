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
import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface ErrorPayload {
  error?: { message?: string };
}

export function ImpersonationForm({
  tenants,
  active,
}: {
  tenants: readonly { id: string; label: string }[];
  active: boolean;
}) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = tenantId !== "" && reason.trim().length >= 8;

  async function start() {
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/impersonation/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenant.id,
          tenant_label: tenant.label,
          reason: reason.trim(),
        }),
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ErrorPayload | null;
        throw new Error(
          payload?.error?.message ?? "Couldn't start impersonation.",
        );
      }
      toast.success(`Now viewing as ${tenant.label}`);
      setTenantId("");
      setReason("");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't start impersonation.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a session</CardTitle>
        <CardDescription>
          Time-boxed to 15 minutes. The banner stays up the whole time and every
          session is audited.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {active ? (
          <Alert>
            <TriangleAlert />
            <AlertTitle>Already impersonating</AlertTitle>
            <AlertDescription>
              End the current session (top banner) before starting another.
            </AlertDescription>
          </Alert>
        ) : null}
        <Field>
          <FieldLabel htmlFor="imp-tenant">Tenant</FieldLabel>
          <Select
            value={tenantId}
            onValueChange={setTenantId}
            disabled={active}
          >
            <SelectTrigger id="imp-tenant">
              <SelectValue placeholder="Choose a tenant" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
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
            disabled={active}
          />
        </Field>
        <div>
          <Button disabled={!valid || active} loading={busy} onClick={start}>
            Start impersonation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

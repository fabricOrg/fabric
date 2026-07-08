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
import { useForm } from "@tanstack/react-form";
import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";

const schema = z.object({
  tenantId: z.string().min(1, "Choose a tenant."),
  reason: z.string().trim().min(8, "Give a reason (min 8 characters)."),
});

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

  const form = useForm({
    defaultValues: { tenantId: "", reason: "" },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const tenant = tenants.find((t) => t.id === value.tenantId);
      if (!tenant) return;
      try {
        const response = await fetch("/api/admin/impersonation/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenant.id,
            tenant_label: tenant.label,
            reason: value.reason.trim(),
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
        form.reset();
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't start impersonation.",
        );
      }
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a session</CardTitle>
        <CardDescription>
          Time-boxed to 15 minutes. The banner stays up the whole time and every
          session is audited.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          {active ? (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Already impersonating</AlertTitle>
              <AlertDescription>
                End the current session (top banner) before starting another.
              </AlertDescription>
            </Alert>
          ) : null}
          <form.Field name="tenantId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="imp-tenant">Tenant</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={field.handleChange}
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
            )}
          </form.Field>
          <form.Field name="reason">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="imp-reason">
                  Reason (min 8 chars)
                </FieldLabel>
                <Input
                  id="imp-reason"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="e.g. Debug failed DLR reconciliation, ticket #4821"
                  disabled={active}
                />
              </Field>
            )}
          </form.Field>
          <div>
            <form.Subscribe
              selector={(s) => [s.canSubmit, s.isSubmitting] as const}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  disabled={!canSubmit || active}
                  loading={isSubmitting}
                >
                  Start impersonation
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

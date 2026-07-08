"use client";

import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { FieldError, fieldInvalid } from "@app/ui/components/ui/form";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useForm } from "@tanstack/react-form";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { provisionTenant } from "@/lib/client/tenants-api";
import { toastApiError } from "@/lib/error-toast";
import type { Tenant } from "@/lib/mock-admin";
import { PLANS, REGIONS, schema, slugify } from "./create-tenant-dialog.schema";

export function CreateTenantDialog({
  onCreated,
}: {
  onCreated: (tenant: Tenant) => void;
}) {
  const [open, setOpen] = useState(false);
  // The slug auto-derives from the name until the operator edits it — non-field UI state.
  const [slugTouched, setSlugTouched] = useState(false);
  const ids = useId();

  const form = useForm({
    defaultValues: {
      name: "",
      slug: "",
      region: REGIONS[0].value as string,
      plan: "growth" as Tenant["plan"],
      adminEmail: "",
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      try {
        const result = await provisionTenant({
          name: value.name.trim(),
          slug: value.slug,
          region: value.region,
          plan: value.plan,
          adminEmail: value.adminEmail.trim(),
        });
        onCreated(result.tenant);
        toast.success("Tenant provisioned", {
          description: `WorkOS org created · invited ${result.invitedEmail} as admin.`,
        });
        setOpen(false);
        setTimeout(reset, 150);
      } catch (payload) {
        toastApiError(payload);
      }
    },
  });

  function reset() {
    form.reset();
    setSlugTouched(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTimeout(reset, 150);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Create tenant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create tenant</DialogTitle>
            <DialogDescription>
              Provisions a WorkOS organization, the account record, and invites
              the first admin. Access stays org-managed SSO.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${ids}-name`}>Business name</FieldLabel>
                  <Input
                    id={`${ids}-name`}
                    value={field.state.value}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      if (!slugTouched) {
                        form.setFieldValue("slug", slugify(e.target.value));
                      }
                    }}
                    onBlur={field.handleBlur}
                    placeholder="KwikGH Ltd"
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="slug">
              {(field) => {
                const invalid = fieldInvalid(field);
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor={`${ids}-slug`}>Slug</FieldLabel>
                    <Input
                      id={`${ids}-slug`}
                      value={field.state.value}
                      onChange={(e) => {
                        setSlugTouched(true);
                        field.handleChange(e.target.value);
                      }}
                      onBlur={field.handleBlur}
                      className="font-mono"
                      placeholder="kwikgh"
                    />
                    {invalid ? (
                      <FieldError field={field} />
                    ) : (
                      <FieldDescription>
                        Used in URLs and API identifiers.
                      </FieldDescription>
                    )}
                  </Field>
                );
              }}
            </form.Field>

            <div className="grid grid-cols-2 gap-4">
              <form.Field name="region">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${ids}-region`}>Region</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={field.handleChange}
                    >
                      <SelectTrigger id={`${ids}-region`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REGIONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
              <form.Field name="plan">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${ids}-plan`}>Plan</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(v) =>
                        field.handleChange(v as Tenant["plan"])
                      }
                    >
                      <SelectTrigger id={`${ids}-plan`} className="capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLANS.map((p) => (
                          <SelectItem key={p} value={p} className="capitalize">
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
            </div>

            <form.Field name="adminEmail">
              {(field) => {
                const invalid = fieldInvalid(field);
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor={`${ids}-email`}>
                      First admin email
                    </FieldLabel>
                    <Input
                      id={`${ids}-email`}
                      type="email"
                      inputMode="email"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="admin@kwikgh.com"
                    />
                    {invalid ? (
                      <FieldError field={field} />
                    ) : (
                      <FieldDescription>
                        They receive a WorkOS invite and become the workspace
                        owner.
                      </FieldDescription>
                    )}
                  </Field>
                );
              }}
            </form.Field>
          </div>

          <DialogFooter>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                </DialogClose>
              )}
            </form.Subscribe>
            <form.Subscribe
              selector={(s) => [s.canSubmit, s.isSubmitting] as const}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  loading={isSubmitting}
                  disabled={!canSubmit}
                >
                  Create tenant
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

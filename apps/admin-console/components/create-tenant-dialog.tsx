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
  FieldError,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { provisionTenant } from "@/lib/client/tenants-api";
import { toastApiError } from "@/lib/error-toast";
import type { Tenant } from "@/lib/mock-admin";

const REGIONS = [
  { value: "gh-accra", label: "Ghana · Accra" },
  { value: "ng-lagos", label: "Nigeria · Lagos" },
  { value: "ke-nairobi", label: "Kenya · Nairobi" },
] as const;
const PLANS: Tenant["plan"][] = ["free", "growth", "scale"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export function CreateTenantDialog({
  onCreated,
}: {
  onCreated: (tenant: Tenant) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [region, setRegion] = useState<string>(REGIONS[0].value);
  const [plan, setPlan] = useState<Tenant["plan"]>("growth");
  const [adminEmail, setAdminEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const ids = useId();

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const slugValid = /^[a-z0-9-]{2,}$/.test(effectiveSlug);
  const emailTouched = adminEmail.length > 0;
  const emailValid = EMAIL.test(adminEmail.trim());
  const canSubmit =
    name.trim().length >= 2 && slugValid && emailValid && !saving;

  function reset() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setRegion(REGIONS[0].value);
    setPlan("growth");
    setAdminEmail("");
  }

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const result = await provisionTenant({
        name: name.trim(),
        slug: effectiveSlug,
        region,
        plan,
        adminEmail: adminEmail.trim(),
      });
      onCreated(result.tenant);
      toast.success("Tenant provisioned", {
        description: `WorkOS org created · invited ${result.invitedEmail} as admin.`,
      });
      setOpen(false);
      setTimeout(reset, 150);
    } catch (payload) {
      toastApiError(payload);
    } finally {
      setSaving(false);
    }
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
        <DialogHeader>
          <DialogTitle>Create tenant</DialogTitle>
          <DialogDescription>
            Provisions a WorkOS organization, the account record, and invites
            the first admin. Access stays org-managed SSO.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <Field>
            <FieldLabel htmlFor={`${ids}-name`}>Business name</FieldLabel>
            <Input
              id={`${ids}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="KwikGH Ltd"
            />
          </Field>

          <Field
            data-invalid={(!slugValid && effectiveSlug.length > 0) || undefined}
          >
            <FieldLabel htmlFor={`${ids}-slug`}>Slug</FieldLabel>
            <Input
              id={`${ids}-slug`}
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              className="font-mono"
              placeholder="kwikgh"
            />
            {!slugValid && effectiveSlug.length > 0 ? (
              <FieldError>
                Lower-case letters, numbers and dashes only.
              </FieldError>
            ) : (
              <FieldDescription>
                Used in URLs and API identifiers.
              </FieldDescription>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor={`${ids}-region`}>Region</FieldLabel>
              <Select value={region} onValueChange={setRegion}>
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
            <Field>
              <FieldLabel htmlFor={`${ids}-plan`}>Plan</FieldLabel>
              <Select
                value={plan}
                onValueChange={(v) => setPlan(v as Tenant["plan"])}
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
          </div>

          <Field data-invalid={(emailTouched && !emailValid) || undefined}>
            <FieldLabel htmlFor={`${ids}-email`}>First admin email</FieldLabel>
            <Input
              id={`${ids}-email`}
              type="email"
              inputMode="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@kwikgh.com"
            />
            {emailTouched && !emailValid ? (
              <FieldError>Enter a valid email address.</FieldError>
            ) : (
              <FieldDescription>
                They receive a WorkOS invite and become the workspace owner.
              </FieldDescription>
            )}
          </Field>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={submit} loading={saving} disabled={!canSubmit}>
            Create tenant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

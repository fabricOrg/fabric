"use client";

import { createApplicationRequestSchema } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface BffErrorPayload {
  error?: { message?: string };
}

/** Derive a contract-valid slug from a free-text name: lowercase, non-alphanumerics → hyphens,
 *  collapse/trim hyphens, cap at 40. Mirrors the contract regex so the suggestion validates. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function CreateApplicationDialog({
  triggerLabel = "New application",
}: {
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Once the user edits the slug directly, stop auto-deriving it from the name.
  const [slugTouched, setSlugTouched] = useState(false);

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: {
      onMount: createApplicationRequestSchema,
      onChange: createApplicationRequestSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        const response = await fetch("/api/applications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: value.name.trim(),
            slug: value.slug.trim(),
          }),
        });
        if (!response.ok) {
          const payload = (await response
            .json()
            .catch(() => null)) as BffErrorPayload | null;
          throw new Error(
            payload?.error?.message ?? "Couldn't create the application.",
          );
        }
        toast.success(`Created ${value.name}`, {
          description:
            "Its sandbox is ready; the live environment unlocks at go-live.",
        });
        setOpen(false);
        setSlugTouched(false);
        form.reset();
        router.refresh(); // reflect the new application in the SSR list
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't create the application.",
        );
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          {triggerLabel}
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
            <DialogTitle>Create an application</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="application-name">Name</FieldLabel>
                  <Input
                    id="application-name"
                    value={field.state.value}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      if (!slugTouched) {
                        form.setFieldValue("slug", slugify(e.target.value));
                      }
                    }}
                    onBlur={field.handleBlur}
                    placeholder="Checkout notifications"
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="slug">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="application-slug">Slug</FieldLabel>
                  <Input
                    id="application-slug"
                    value={field.state.value}
                    onChange={(e) => {
                      setSlugTouched(true);
                      field.handleChange(e.target.value);
                    }}
                    onBlur={field.handleBlur}
                    placeholder="checkout-notifications"
                  />
                </Field>
              )}
            </form.Field>
          </div>
          <DialogFooter>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
              )}
            </form.Subscribe>
            <form.Subscribe
              selector={(s) => [s.canSubmit, s.isSubmitting] as const}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  loading={isSubmitting}
                >
                  Create application
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

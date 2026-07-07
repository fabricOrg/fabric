"use client";

import { cn } from "@app/ui/lib/utils";
import type { AnyFieldApi } from "@tanstack/react-form";

/**
 * Thin bridge between TanStack Form and our Field primitives (field.tsx). Forms compose:
 *
 *   <form.Field name="name">
 *     {(field) => (
 *       <Field data-invalid={fieldInvalid(field)}>
 *         <FieldLabel htmlFor={field.name}>Name</FieldLabel>
 *         <Input id={field.name} value={field.state.value}
 *           onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
 *         <FieldError field={field} />
 *       </Field>
 *     )}
 *   </form.Field>
 *
 * Keeping the kit minimal (no bespoke input wrappers) means every existing @app/ui control —
 * Input, Textarea, Select, the date pickers — drops straight in.
 */

/** A field is in an error state once touched + failing validation. */
export function fieldInvalid(field: AnyFieldApi): boolean {
  return field.state.meta.isTouched && !field.state.meta.isValid;
}

/** Render a field's validation errors (zod issues → strings). Renders nothing when valid/untouched. */
export function FieldError({
  field,
  className,
}: {
  field: AnyFieldApi;
  className?: string;
}) {
  if (!fieldInvalid(field)) return null;
  const message = field.state.meta.errors
    .map((error) =>
      typeof error === "string" ? error : (error?.message ?? ""),
    )
    .filter(Boolean)
    .join(", ");
  if (!message) return null;
  return <p className={cn("text-sm text-destructive", className)}>{message}</p>;
}

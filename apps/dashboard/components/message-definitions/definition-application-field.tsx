"use client";

import type { ApplicationDto } from "@app/contracts";
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
import { useEffect } from "react";

/**
 * Application picker for the definition author.
 *
 * The list is PASSED IN, not fetched. It used to `fetch("/api/applications")`, but that route only
 * exports POST — so the GET returned 405, the field showed "Applications could not be loaded", and
 * authoring a definition was impossible through the UI. The page rendering this form is a server
 * component that has already loaded the same list for its own selector, so handing it down removes a
 * network round-trip, a parse, an error state, and the endpoint that never existed.
 */
export function DefinitionApplicationField({
  enabled,
  applications,
  applicationId,
  onChange,
}: {
  enabled: boolean;
  applications: readonly ApplicationDto[];
  applicationId: string;
  onChange: (applicationId: string) => void;
}) {
  const firstId = applications[0]?.id;
  // Default to the first application once, when the form opens with nothing selected.
  useEffect(() => {
    if (enabled && !applicationId && firstId) onChange(firstId);
  }, [applicationId, enabled, firstId, onChange]);

  return (
    <Field>
      <FieldLabel htmlFor="def-application">Application</FieldLabel>
      <Select value={applicationId} onValueChange={onChange}>
        <SelectTrigger
          id="def-application"
          disabled={!enabled || applications.length === 0}
        >
          <SelectValue placeholder="Select an application" />
        </SelectTrigger>
        <SelectContent>
          {applications.map((application) => (
            <SelectItem key={application.id} value={application.id}>
              {application.name} ({application.slug})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {applications.length === 0
          ? "Create an application first — a definition's stable key belongs to one."
          : "The stable key belongs only to this application."}
      </FieldDescription>
    </Field>
  );
}

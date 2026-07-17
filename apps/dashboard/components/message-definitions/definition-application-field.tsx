"use client";

import {
  type ApplicationDto,
  listApplicationsResponseSchema,
} from "@app/contracts";
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
import { useEffect, useState } from "react";

export function DefinitionApplicationField({
  enabled,
  applicationId,
  onChange,
}: {
  enabled: boolean;
  applicationId: string;
  onChange: (applicationId: string) => void;
}) {
  const [applications, setApplications] = useState<ApplicationDto[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || applications.length > 0 || failed) return;
    let current = true;
    fetch("/api/applications")
      .then(async (response) => {
        if (!response.ok) throw new Error("Applications could not be loaded.");
        return listApplicationsResponseSchema.parse(await response.json());
      })
      .then(({ applications: loaded }) => {
        if (!current) return;
        setApplications(loaded);
        if (!applicationId && loaded[0]) onChange(loaded[0].id);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [applicationId, applications.length, enabled, failed, onChange]);

  return (
    <Field>
      <FieldLabel htmlFor="def-application">Application</FieldLabel>
      <Select value={applicationId} onValueChange={onChange}>
        <SelectTrigger id="def-application" disabled={!enabled || failed}>
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
        {failed
          ? "Applications could not be loaded. Close and try again."
          : "The stable key belongs only to this application."}
      </FieldDescription>
    </Field>
  );
}

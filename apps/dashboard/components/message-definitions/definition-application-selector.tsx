"use client";

import type { ApplicationDto } from "@app/contracts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useRouter } from "next/navigation";

export function DefinitionApplicationSelector({
  applications,
  selectedSlug,
  basePath = "/message-definitions",
}: {
  applications: ApplicationDto[];
  selectedSlug: string;
  basePath?: string;
}) {
  const router = useRouter();
  return (
    <Select
      value={selectedSlug}
      onValueChange={(slug) =>
        router.replace(`${basePath}?application=${encodeURIComponent(slug)}`)
      }
    >
      <SelectTrigger aria-label="Application" className="w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {applications.map((application) => (
          <SelectItem key={application.id} value={application.slug}>
            {application.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

"use client";

import type { SmsTemplate } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { renderTemplate } from "@/lib/send/preflight";
import {
  getTemplateSelectionLabel,
  resolveTemplateSelection,
} from "@/lib/send/template-selection";

/** Controlled template picker. Custom mode deliberately preserves the current body for editing. */
export function TemplateBar({
  templates,
  selectedId,
  onSelect,
}: {
  templates: readonly SmsTemplate[];
  selectedId: string | null;
  onSelect: (template: SmsTemplate | null) => void;
}) {
  const selectedLabel = getTemplateSelectionLabel(templates, selectedId);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selectedId ?? "custom"}
        onValueChange={(value) =>
          onSelect(resolveTemplateSelection(templates, value))
        }
      >
        <SelectTrigger
          className="h-8 w-48 text-sm"
          aria-label="Message template"
        >
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="custom">Custom message</SelectItem>
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {template.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Link
        href="/templates"
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Manage
      </Link>
    </div>
  );
}

/** Merge-field sample inputs + a live preview. Real per-recipient values arrive via API/CSV; this
 * preview uses the operator's sample values so they can see the rendered message + its true length. */
export function PersonalizeFields({
  tokens,
  values,
  onChange,
  body,
}: {
  tokens: readonly string[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  body: string;
}) {
  if (tokens.length === 0) return null;
  const preview = renderTemplate(body, values);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" aria-hidden />
        Personalize
        <Badge variant="secondary" className="font-normal">
          {tokens.length} field{tokens.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tokens.map((token) => (
          <label
            key={token}
            htmlFor={`merge-${token}`}
            className="flex flex-col gap-1 text-xs"
          >
            <span className="font-mono text-muted-foreground">{`{{${token}}}`}</span>
            <Input
              id={`merge-${token}`}
              value={values[token] ?? ""}
              onChange={(e) => onChange({ ...values, [token]: e.target.value })}
              placeholder={`Sample ${token}`}
              className="h-8"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Preview</span>
        <p className="rounded-md bg-background p-2 text-sm">{preview}</p>
        <span className="text-xs text-muted-foreground">
          Each recipient gets their own values at send time (via the API or a
          CSV upload). This preview uses your sample values.
        </span>
      </div>
    </div>
  );
}

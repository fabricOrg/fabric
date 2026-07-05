"use client";

import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { BookmarkPlus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { renderTemplate } from "@/lib/send/preflight";

interface Template {
  readonly name: string;
  readonly body: string;
}

/** Starter templates — each shows the merge-field + opt-out patterns we want tenants to copy. */
const PRESETS: readonly Template[] = [
  {
    name: "OTP / verification",
    body: "Your Fabric verification code is {{code}}. It expires in 10 minutes — do not share it.",
  },
  {
    name: "Order confirmation",
    body: "Hi {{name}}, your order {{ref}} is confirmed. Track it here: {{link}}",
  },
  {
    name: "Delivery update",
    body: "Hi {{name}}, your delivery {{ref}} is on the way and arrives {{eta}}.",
  },
  {
    name: "Payment received",
    body: "Hi {{name}}, we received your payment of {{amount}}. Thank you!",
  },
  {
    name: "Promo (with opt-out)",
    body: "{{name}}, enjoy 20% off this week at Fabric. Reply STOP to opt out.",
  },
];

const STORAGE_KEY = "fabric.sms.templates.v1";

function loadSaved(): Template[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is Template =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as Template).name === "string" &&
        typeof (t as Template).body === "string",
    );
  } catch {
    return [];
  }
}

function autoName(body: string): string {
  const words = body.trim().split(/\s+/).slice(0, 5).join(" ");
  return words.length > 32 ? `${words.slice(0, 32)}…` : words || "Untitled";
}

/** Template picker + save. Applying a template replaces the message body (via onApply). */
export function TemplateBar({
  body,
  onApply,
}: {
  body: string;
  onApply: (body: string) => void;
}) {
  const [saved, setSaved] = useState<Template[]>([]);

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  function apply(value: string) {
    const all = [...PRESETS, ...saved];
    const match = all.find((t) => t.name === value);
    if (match) onApply(match.body);
  }

  function save() {
    if (body.trim().length === 0) return;
    const template: Template = { name: autoName(body), body };
    const next = [template, ...saved.filter((t) => t.body !== body)].slice(
      0,
      20,
    );
    setSaved(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      toast.success("Template saved", { description: template.name });
    } catch {
      toast.error("Couldn't save template");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value="" onValueChange={apply}>
        <SelectTrigger
          className="h-8 w-48 text-sm"
          aria-label="Insert a template"
        >
          <SelectValue placeholder="Templates…" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Starters</SelectLabel>
            {PRESETS.map((t) => (
              <SelectItem key={t.name} value={t.name}>
                {t.name}
              </SelectItem>
            ))}
          </SelectGroup>
          {saved.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Saved</SelectLabel>
              {saved.map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={save}
        disabled={body.trim().length === 0}
      >
        <BookmarkPlus data-icon="inline-start" />
        Save
      </Button>
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

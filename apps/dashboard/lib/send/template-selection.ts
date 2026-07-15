import type { SmsTemplate } from "@app/contracts";

export function resolveTemplateSelection(
  templates: readonly SmsTemplate[],
  value: string,
): SmsTemplate | null {
  if (value === "custom") return null;
  return templates.find((template) => template.id === value) ?? null;
}

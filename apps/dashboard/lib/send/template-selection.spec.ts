import type { SmsTemplate } from "@app/contracts";
import { describe, expect, it } from "vitest";
import { resolveTemplateSelection } from "./template-selection";

const template: SmsTemplate = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Receipt",
  body: "Payment received.",
  class: "transactional",
  created_at: "2026-07-15T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
};

describe("TemplateBar selection", () => {
  it("keeps the selected template visible by resolving its id", () => {
    expect(resolveTemplateSelection([template], template.id)).toBe(template);
  });

  it("returns to custom-message mode explicitly", () => {
    expect(resolveTemplateSelection([template], "custom")).toBeNull();
  });
});

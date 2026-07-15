import { describe, expect, it } from "vitest";
import {
  createSmsTemplateRequest,
  updateSmsTemplateRequest,
} from "./sms-templates.js";

describe("SMS template contracts", () => {
  it("accepts a classified reusable message", () => {
    expect(
      createSmsTemplateRequest.parse({
        name: "Payment receipt",
        body: "Hi {{name}}, payment received.",
        class: "transactional",
      }),
    ).toEqual({
      name: "Payment receipt",
      body: "Hi {{name}}, payment received.",
      class: "transactional",
    });
  });

  it("rejects empty updates and invalid classifications", () => {
    expect(updateSmsTemplateRequest.safeParse({}).success).toBe(false);
    expect(
      createSmsTemplateRequest.safeParse({
        name: "Offer",
        body: "Save today",
        class: "unknown",
      }).success,
    ).toBe(false);
  });
});

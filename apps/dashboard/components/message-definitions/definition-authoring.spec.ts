import type { SmsTemplate, VariableSchema } from "@app/contracts";
import { describe, expect, it } from "vitest";
import {
  buildVariableSchema,
  samplePayload,
  supportsVisualSchema,
  templateToDefinitionDraft,
  variablesFromBody,
  variablesFromSchema,
} from "./definition-authoring";

describe("message definition authoring", () => {
  it("detects unique template variables and builds a closed nested schema", () => {
    const fields = variablesFromBody(
      "Hi {{customer.name}}, ref {{order.id}} / {{customer.name}}",
    );
    const result = buildVariableSchema(fields);
    expect(result.error).toBeNull();
    expect(result.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["customer", "order"],
      properties: {
        customer: { required: ["name"] },
        order: { required: ["id"] },
      },
    });
  });

  it("preserves supported constraints and detects schemas that need advanced editing", () => {
    const schema: VariableSchema = {
      type: "object",
      properties: {
        email: { type: "string", format: "email", maxLength: 100 },
      },
      required: ["email"],
      additionalProperties: false,
    };
    expect(supportsVisualSchema(schema)).toBe(true);
    const rebuilt = buildVariableSchema(variablesFromSchema(schema));
    expect(rebuilt.schema).toEqual(schema);
    expect(
      supportsVisualSchema({
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" }, maxItems: 5 },
        },
      }),
    ).toBe(false);
  });

  it("builds typed nested sample data", () => {
    const fields = variablesFromBody("{{order.count}} {{paid}}").map((field) =>
      field.name === "order.count"
        ? { ...field, type: "integer" as const }
        : { ...field, type: "boolean" as const },
    );
    const count = fields[0];
    const paid = fields[1];
    if (!count || !paid) throw new Error("Expected detected variables.");
    expect(
      samplePayload(fields, {
        [count.id]: "4",
        [paid.id]: "true",
      }),
    ).toEqual({ order: { count: 4 }, paid: true });
  });

  it("converts a template into an independently reviewable draft without mutation", () => {
    const template = {
      id: "4fdbfcbb-40ad-463a-a860-a1a40de140d2",
      name: "Order shipped",
      body: "Hi {{name}}, order {{reference}} shipped.",
      class: "transactional",
      created_at: "2026-07-15T00:00:00.000Z",
      updated_at: "2026-07-15T00:00:00.000Z",
    } satisfies SmsTemplate;
    const before = structuredClone(template);
    const draft = templateToDefinitionDraft(template);
    expect(draft).toMatchObject({ key: "order.shipped", body: template.body });
    expect(draft.variables.map((field) => field.name)).toEqual([
      "name",
      "reference",
    ]);
    expect(template).toEqual(before);
  });

  it("rejects scalar/nested path collisions", () => {
    const fields = variablesFromBody("{{customer}} {{customer.name}}");
    expect(buildVariableSchema(fields)).toMatchObject({ schema: null });
  });

  it("restores editable fields from a nested definition schema", () => {
    const built = buildVariableSchema([
      { id: "name", name: "customer.name", type: "string", required: true },
      { id: "age", name: "customer.age", type: "integer", required: false },
      { id: "paid", name: "paid", type: "boolean", required: true },
    ]);
    if (!built.schema)
      throw new Error(built.error ?? "Expected a valid schema.");
    expect(
      variablesFromSchema(built.schema).map(({ name, type, required }) => ({
        name,
        type,
        required,
      })),
    ).toEqual([
      { name: "customer.name", type: "string", required: true },
      { name: "customer.age", type: "integer", required: false },
      { name: "paid", type: "boolean", required: true },
    ]);
  });
});

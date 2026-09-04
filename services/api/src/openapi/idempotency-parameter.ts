export function idempotencyParameter(
  requirement: "optional" | "required",
): Record<string, unknown> {
  return {
    name: "Idempotency-Key",
    in: "header",
    required: requirement === "required",
    description:
      "Stable identity for one logical write. Reuse it only when retrying the same request.",
    schema: { type: "string", minLength: 1, maxLength: 255 },
  };
}

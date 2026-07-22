import { ResponseValidationError, ValidationError } from "./errors.js";

export function requireNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new ValidationError(`\`${name}\` must be a non-empty string.`, {
      code: "invalid_field",
      details: { param: name },
    });
  }
}

export function requireE164(value: string): void {
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    throw new ValidationError(
      "`to` must be an E.164 phone number, for example +233545227189.",
      {
        code: "invalid_phone_number",
        details: { param: "to" },
      },
    );
  }
}

// A managed recipient is an E.164 number (SMS) or an email address (Email); the definition's channel
// decides which is valid, and the server rejects a mismatch. The SDK only rejects a value that is
// neither shape, so a client-side typo fails before any request. The email check is intentionally
// permissive (has an `@` with text either side) — full RFC validation is the server's job.
export function requireRecipient(value: string): void {
  const isE164 = /^\+[1-9]\d{7,14}$/.test(value);
  const isEmail = /^[^@\s]+@[^@\s]+$/.test(value);
  if (!isE164 && !isEmail) {
    throw new ValidationError(
      "`to` must be an E.164 phone number (e.g. +233545227189) or an email address.",
      {
        code: "invalid_recipient",
        details: { param: "to" },
      },
    );
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiShapeError();
  }
  return value as Record<string, unknown>;
}

export function stringField(value: unknown, name: string): string {
  if (typeof value !== "string") throw new ApiShapeError(name);
  return value;
}

export function numberField(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiShapeError(name);
  }
  return value;
}

export function booleanField(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new ApiShapeError(name);
  return value;
}

export function enumField<const T extends readonly string[]>(
  value: unknown,
  values: T,
  name: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new ApiShapeError(name);
  }
  return value as T[number];
}

export class ApiShapeError extends ResponseValidationError {
  constructor(field?: string) {
    super(
      `Fabric returned a response that does not match the SDK contract${field ? ` at \`${field}\`` : ""}.`,
      { code: "invalid_api_response" },
    );
  }
}

import type { WriteOptions } from "./types.js";

const PROTECTED_HEADERS = new Set([
  "authorization",
  "idempotency-key",
  "user-agent",
]);

export function validateTransportOptions(
  options: WriteOptions | undefined,
): void {
  for (const name of Object.keys(options?.headers ?? {})) {
    if (PROTECTED_HEADERS.has(name.toLowerCase())) {
      throw new TypeError(
        `The protected header \`${name}\` cannot be overridden.`,
      );
    }
  }
  if (
    options?.timeout !== undefined &&
    (!Number.isFinite(options.timeout) || options.timeout <= 0)
  ) {
    throw new TypeError("`timeout` must be a positive number of milliseconds.");
  }
  if (
    options?.idempotencyKey !== undefined &&
    (options.idempotencyKey.trim().length === 0 ||
      options.idempotencyKey.length > 255)
  ) {
    throw new TypeError(
      "`idempotencyKey` must contain between 1 and 255 characters.",
    );
  }
}

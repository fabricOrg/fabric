import type { ConfigService } from "@nestjs/config";

export interface SandboxAllowanceLimits {
  readonly sms: bigint;
  readonly email: bigint;
  readonly whatsapp: bigint;
}

export function sandboxAllowanceDefaults(
  config?: ConfigService,
): SandboxAllowanceLimits {
  return {
    sms: configuredLimit(
      config?.get<string>("SANDBOX_SMS_SEGMENTS_PER_DAY"),
      "SANDBOX_SMS_SEGMENTS_PER_DAY",
      100n,
    ),
    email: configuredLimit(
      config?.get<string>("SANDBOX_EMAIL_MESSAGES_PER_DAY"),
      "SANDBOX_EMAIL_MESSAGES_PER_DAY",
      200n,
    ),
    whatsapp: configuredLimit(
      config?.get<string>("SANDBOX_WHATSAPP_MESSAGES_PER_DAY"),
      "SANDBOX_WHATSAPP_MESSAGES_PER_DAY",
      100n,
    ),
  };
}

export function resolveSandboxAllowanceLimits(
  settings: unknown,
  defaults: SandboxAllowanceLimits,
): SandboxAllowanceLimits {
  const root = record(settings);
  const configured = record(root?.sandbox_allowances);
  return {
    sms: positiveBigint(configured?.sms_segments_per_day) ?? defaults.sms,
    email: positiveBigint(configured?.email_messages_per_day) ?? defaults.email,
    whatsapp:
      positiveBigint(configured?.whatsapp_messages_per_day) ??
      defaults.whatsapp,
  };
}

function configuredLimit(
  raw: string | undefined,
  name: string,
  fallback: bigint,
): bigint {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return BigInt(raw);
}

function positiveBigint(value: unknown): bigint | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^[1-9]\d*$/.test(String(value))
  ) {
    return null;
  }
  return BigInt(String(value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

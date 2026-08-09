import { z } from "zod";

export const sandboxAllowanceChannel = z.enum(["sms", "email", "whatsapp"]);
export type SandboxAllowanceChannel = z.infer<typeof sandboxAllowanceChannel>;

export const sandboxAllowanceUnit = z.enum(["segment", "message"]);
export type SandboxAllowanceUnit = z.infer<typeof sandboxAllowanceUnit>;

export const sandboxAllowance = z.object({
  channel: sandboxAllowanceChannel,
  unit: sandboxAllowanceUnit,
  used: z.string().regex(/^\d+$/),
  limit: z.string().regex(/^[1-9]\d*$/),
  remaining: z.string().regex(/^\d+$/),
});
export type SandboxAllowance = z.infer<typeof sandboxAllowance>;

export const sandboxAllowancesResponse = z.object({
  date: z.string().date(),
  reset_at: z.string().datetime(),
  allowances: z.array(sandboxAllowance).length(3),
  request_id: z.string(),
});
export type SandboxAllowancesResponse = z.infer<
  typeof sandboxAllowancesResponse
>;

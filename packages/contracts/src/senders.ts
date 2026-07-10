// Sender-ID registry shapes (E10 / C-2). Registration status is a DELIVERY GATE in Nigeria
// (unregistered sender id ⇒ carrier rejects); the send path enforces `active` for live tenants.

import { z } from "zod";

export const senderStatusSchema = z.enum(["pending", "active", "rejected"]);
export type SenderStatus = z.infer<typeof senderStatusSchema>;

export const senderCountrySchema = z.enum(["GH", "NG"]);
export const senderTypeSchema = z.enum(["alphanumeric", "short-code"]);

export const senderDtoSchema = z.object({
  id: z.string().uuid(),
  sender_id: z.string(),
  country: senderCountrySchema,
  type: senderTypeSchema,
  use_case: z.string(),
  status: senderStatusSchema,
  rejection_reason: z.string().nullable(),
  created_at: z.string(),
});
export type SenderDto = z.infer<typeof senderDtoSchema>;

export const listSendersResponseSchema = z.object({
  senders: z.array(senderDtoSchema),
});
export type ListSendersResponse = z.infer<typeof listSendersResponseSchema>;

export const createSenderRequestSchema = z.object({
  // GSM alphanumeric sender ids: ≤11 chars, letters/digits/space (no leading/trailing space).
  sender_id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ]{0,10}$/, "1-11 letters, digits or spaces"),
  country: senderCountrySchema,
  type: senderTypeSchema.default("alphanumeric"),
  use_case: z.string().trim().min(10).max(500),
});
export type CreateSenderRequest = z.infer<typeof createSenderRequestSchema>;

/** Staff review queue row — the customer DTO plus the owning tenant. */
export const adminSenderDtoSchema = senderDtoSchema.extend({
  tenant_id: z.string().uuid(),
});
export type AdminSenderDto = z.infer<typeof adminSenderDtoSchema>;

export const listAdminSendersResponseSchema = z.object({
  senders: z.array(adminSenderDtoSchema),
});
export type ListAdminSendersResponse = z.infer<
  typeof listAdminSendersResponseSchema
>;

/** Staff decision on a registration (admin console / ops). */
export const decideSenderRequestSchema = z.object({
  status: z.enum(["active", "rejected"]),
  reason: z.string().trim().max(500).optional(),
});
export type DecideSenderRequest = z.infer<typeof decideSenderRequestSchema>;

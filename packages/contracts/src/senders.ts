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

/**
 * The CARRIER side of a registration. STAFF-ONLY — deliberately absent from `senderDtoSchema`, so a
 * customer response cannot carry it even by accident.
 *
 * We cannot automate this: Arkesel exposes no sender-ID registration endpoint, so registration is an
 * operator action in their dashboard plus network-level approval. `submitted` is the honest
 * in-between state — asked, not yet answered.
 */
export const senderCarrierStatusSchema = z.enum([
  "unregistered",
  "submitted",
  "approved",
  "rejected",
]);
export type SenderCarrierStatus = z.infer<typeof senderCarrierStatusSchema>;

/** Staff review queue row — the customer DTO plus the owning tenant and the carrier side. */
export const adminSenderDtoSchema = senderDtoSchema.extend({
  // guid() not uuid(): tenant ids are UUID-shaped opaque identifiers from our own DB, but the dev
  // seed tenant (SEED_TENANT_ID = 00000000-…-00d1) isn't RFC-version-compliant, and zod v4's uuid()
  // rejects it. guid() keeps the shape check without the version pedantry; real v4 tenants still pass.
  tenant_id: z.string().guid(),
  carrier_status: senderCarrierStatusSchema,
  carrier_ref: z.string().nullable(),
  carrier_decided_at: z.string().nullable(),
});
export type AdminSenderDto = z.infer<typeof adminSenderDtoSchema>;

/**
 * Staff recording what the CARRIER said. Separate from `decideSenderRequestSchema` because they are
 * different facts: this one reports an external outcome we observed, that one is our own decision.
 * Collapsing them would let an operator approve a customer while only intending to note progress.
 */
export const setSenderCarrierStatusRequestSchema = z.object({
  carrier_status: senderCarrierStatusSchema,
  /** The carrier's reference for the registration, when it gives one. Free text — there is no API. */
  carrier_ref: z.string().trim().max(200).optional(),
});
export type SetSenderCarrierStatusRequest = z.infer<
  typeof setSenderCarrierStatusRequestSchema
>;

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

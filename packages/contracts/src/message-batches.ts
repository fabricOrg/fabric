import { z } from "zod";
import { messageStatus } from "./message-status.js";

export const smsBatchItemRequest = z.object({
  client_reference: z.string().trim().min(1).max(100),
  to: z.unknown(),
  sender_id: z.unknown(),
  body: z.unknown(),
  currency: z.unknown().optional(),
  class: z.unknown().optional(),
});

export const sendSmsBatchRequest = z
  .object({ items: z.array(smsBatchItemRequest).min(1).max(100) })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      if (seen.has(item.client_reference)) {
        context.addIssue({
          code: "custom",
          message: "Each client_reference must be unique within the batch.",
          path: ["items", index, "client_reference"],
        });
      }
      seen.add(item.client_reference);
    }
  });
export type SendSmsBatchRequest = z.infer<typeof sendSmsBatchRequest>;

export const smsBatchItemResult = z.object({
  client_reference: z.string(),
  message_id: z.string().uuid().nullable(),
  status: z.union([messageStatus, z.literal("failed")]),
  error_code: z.string().nullable(),
});
export type SmsBatchItemResult = z.infer<typeof smsBatchItemResult>;

export const smsBatchResponse = z.object({
  id: z.string().uuid(),
  status: z.enum(["processing", "completed"]),
  total_count: z.number().int().positive(),
  accepted_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
  items: z.array(smsBatchItemResult),
  request_id: z.string(),
});
export type SmsBatchResponse = z.infer<typeof smsBatchResponse>;

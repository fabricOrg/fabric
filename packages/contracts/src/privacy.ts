import { z } from "zod";

/**
 * DATA-SUBJECT RIGHTS (COMPLIANCE §6). Staff act on a PHONE NUMBER — that is what a person quotes
 * when they ask to be forgotten — and the platform resolves it to a `subject_id` surrogate through
 * the blind index. The raw number is never returned; only a masked form.
 */

export const erasureRequestSchema = z.object({
  msisdn: z.string().regex(/^\+[1-9]\d{7,14}$/, "Valid E.164 required."),
  /**
   * The legal basis is REQUIRED and free-text: an erasure is irreversible, and "why" is the thing a
   * regulator asks for years later, when nobody remembers. Long enough to be a real answer.
   */
  basis: z
    .string()
    .trim()
    .min(8, "State the legal basis for the erasure (min 8 characters)."),
});
export type ErasureRequest = z.infer<typeof erasureRequestSchema>;

export const subjectSummarySchema = z.object({
  subject_id: z.string().uuid(),
  msisdn_masked: z.string(),
  /** WHICH kinds of personal data are held — never the values themselves. */
  kinds: z.array(z.string()),
  erased: z.boolean(),
});
export type SubjectSummary = z.infer<typeof subjectSummarySchema>;

export const erasureResultSchema = z.object({
  subject_id: z.string().uuid(),
  /** False when the subject had already been erased — the request is still recorded. */
  erased: z.boolean(),
});
export type ErasureResult = z.infer<typeof erasureResultSchema>;

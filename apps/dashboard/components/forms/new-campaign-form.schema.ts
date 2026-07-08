import { DEFAULT_RATES, encodeAndSegment, rateSegments } from "@app/domain";
import { z } from "zod";

export const CURRENCY = "GHS" as const;

export type Schedule = "now" | "later";

/** Same rules the button used to gate on: a non-empty name/message and a positive-integer audience. */
export const schema = z.object({
  name: z.string().trim().min(1, "Enter a campaign name."),
  body: z.string().trim().min(1, "Type a message."),
  audience: z.string().refine((v) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n > 0;
  }, "Enter a positive audience size."),
});

/** Midnight today — the calendar disables anything before it (can't schedule in the past). */
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Exact cost = ratePerSegment × segments(body) × audienceSize, all bigint minor units, never float. */
export function estimate(body: string, audience: string) {
  const audienceSize = Number.parseInt(audience, 10);
  const hasAudience = Number.isInteger(audienceSize) && audienceSize > 0;
  const seg = encodeAndSegment(body || " ");
  const perSegmentMinor = rateSegments(1, CURRENCY, DEFAULT_RATES);
  const show = body.length > 0 && hasAudience;
  const estimateMinor = show
    ? perSegmentMinor * BigInt(seg.segments) * BigInt(audienceSize)
    : 0n;
  return { audienceSize, seg, perSegmentMinor, show, estimateMinor };
}

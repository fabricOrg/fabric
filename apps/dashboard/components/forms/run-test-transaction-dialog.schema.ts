import { z } from "zod";
import { parseAmountToMinor } from "@/lib/money";

export const CURRENCY = "GHS";
export const E164 = /^\+[1-9]\d{7,14}$/;

export function parseMinor(raw: string): string | null {
  try {
    const minor = parseAmountToMinor(raw, CURRENCY);
    return minor !== null && minor > 0n ? minor.toString() : null;
  } catch {
    return null;
  }
}

export const schema = z.object({
  msisdn: z.string().refine((v) => E164.test(v.trim())),
  amount: z.string().refine((v) => parseMinor(v) !== null),
  channel: z.string(),
  code: z.string(),
});

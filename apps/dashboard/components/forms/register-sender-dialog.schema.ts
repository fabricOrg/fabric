import { z } from "zod";
import { ALPHANUMERIC_MAX_LEN } from "@/lib/client/senders-api";

const USE_CASE_MIN_LEN = 10;

/**
 * Sender-ID validity is type-dependent, so validation runs at the form level (superRefine) and maps
 * each issue back to the field it belongs to — preserving the exact messages the dialog showed before.
 */
export const schema = z
  .object({
    senderId: z.string(),
    country: z.enum(["NG", "GH"]),
    type: z.enum(["alphanumeric", "short-code"]),
    useCase: z.string(),
  })
  .superRefine((val, ctx) => {
    const trimmedId = val.senderId.trim();
    if (!trimmedId) {
      ctx.addIssue({
        code: "custom",
        path: ["senderId"],
        message: "Enter a sender ID.",
      });
    } else if (val.type === "alphanumeric") {
      if (!/^[A-Za-z0-9]+$/.test(trimmedId)) {
        ctx.addIssue({
          code: "custom",
          path: ["senderId"],
          message: "Use letters and digits only — no spaces or symbols.",
        });
      } else if (trimmedId.length > ALPHANUMERIC_MAX_LEN) {
        ctx.addIssue({
          code: "custom",
          path: ["senderId"],
          message: `Alphanumeric sender IDs are capped at ${ALPHANUMERIC_MAX_LEN} characters.`,
        });
      }
    } else if (!/^\d{3,8}$/.test(trimmedId)) {
      ctx.addIssue({
        code: "custom",
        path: ["senderId"],
        message: "Short codes must be 3–8 digits.",
      });
    }

    if (val.useCase.trim().length < USE_CASE_MIN_LEN) {
      ctx.addIssue({
        code: "custom",
        path: ["useCase"],
        message: "Describe how you'll use this sender ID (min 10 characters).",
      });
    }
  });

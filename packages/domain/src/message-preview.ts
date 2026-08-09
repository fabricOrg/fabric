import type { VariableSchema } from "@app/contracts";
import { type EmailPreviewOutcome, previewEmail } from "./email-render.js";
import { type PreviewOutcome, previewSms } from "./message-render.js";
import type { RateTable } from "./rating.js";
import {
  previewWhatsapp,
  type WhatsappPreviewOutcome,
} from "./whatsapp-render.js";

/**
 * Channel dispatcher over the pure per-channel preview cores (SDK-007 slice 2). The managed engine
 * resolves a released version's channel, then previews (and later sends) through this one entry point,
 * keeping renderer parity: the same function a preview calls is the one a send calls.
 */

export type MessagePreviewInput =
  | {
      readonly channel: "sms";
      readonly template: string;
      readonly schema: VariableSchema;
      readonly data: unknown;
      readonly currency: string;
      readonly rates?: RateTable;
    }
  | {
      readonly channel: "email";
      readonly subject: string;
      readonly text?: string;
      readonly html?: string;
      readonly schema: VariableSchema;
      readonly data: unknown;
      readonly currency: string;
      readonly rates?: RateTable;
    }
  | {
      readonly channel: "whatsapp";
      readonly templateName: string;
      readonly templateLanguage: string;
      readonly templateCategory: "marketing" | "utility" | "authentication";
      readonly parameters: readonly string[];
      readonly schema: VariableSchema;
      readonly data: unknown;
      readonly currency: string;
      readonly rates?: RateTable;
    };

export type MessagePreviewOutcome =
  | ({ readonly channel: "sms" } & PreviewOutcome)
  | ({ readonly channel: "email" } & EmailPreviewOutcome)
  | ({ readonly channel: "whatsapp" } & WhatsappPreviewOutcome);

export function previewMessage(
  input: MessagePreviewInput,
): MessagePreviewOutcome {
  if (input.channel === "email") {
    return { channel: "email", ...previewEmail(input) };
  }
  if (input.channel === "whatsapp") {
    return { channel: "whatsapp", ...previewWhatsapp(input) };
  }
  return { channel: "sms", ...previewSms(input) };
}

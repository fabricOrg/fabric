import type {
  EmailPreview,
  RenderError,
  SmsPreview,
  WhatsappPreview,
} from "@app/domain";

/**
 * The shape MessagePreviewService returns and the managed send path projects from. Lives in its own
 * module so the per-channel branches (which are big enough to want their own files under the length
 * guard) can import it without a cycle back through the service.
 *
 * Per-channel results are carried in separate nullable fields discriminated by `channel`, rather than a
 * discriminated union, because this shape is also the wire response: an SMS consumer that only reads
 * `preview` keeps working when a channel is added.
 */
export interface PreviewOutput {
  readonly channel: "sms" | "email" | "whatsapp";
  readonly definition_id: string;
  readonly version_id: string;
  readonly environment: "sandbox" | "live";
  readonly resolved_locale: string;
  readonly blockers: readonly RenderError[];
  readonly warnings: readonly RenderError[];
  readonly eligible: boolean;
  readonly sender: {
    readonly sender_id: string;
    readonly status:
      | "sandbox"
      | "active"
      | "pending"
      | "rejected"
      | "unregistered"
      | "not_evaluated";
  };
  readonly message_class: "transactional" | "promotional";
  readonly preview: SmsPreview | null;
  readonly email_preview: EmailPreview | null;
  readonly whatsapp_preview: WhatsappPreview | null;
  readonly email_from: string | null;
}

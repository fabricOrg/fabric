/**
 * Preview result types, split out of types.ts for the file-length guard. Re-exported from types.js so
 * every existing import path is unchanged.
 */

/** A field-path error that blocks a preview. Carries a path + stable code, never the rejected value. */
export interface PreviewBlocker {
  readonly path: string;
  readonly code: string;
}

/** The rendered SMS a preview produced (present only for an SMS channel with no blockers). */
export interface SmsPreview {
  readonly body: string;
  readonly encoding: "gsm7" | "ucs2";
  readonly length: number;
  readonly segments: number;
  readonly costMinor: string;
  readonly currency: string;
}

/** The rendered email a preview produced (present only for an Email channel with no blockers). */
export interface EmailPreview {
  readonly subject: string;
  readonly text: string | null;
  readonly html: string | null;
  /** Rendered UTF-8 byte size (measured to enforce the 256 KiB ceiling; email is priced flat per send). */
  readonly sizeBytes: number;
  readonly costMinor: string;
  readonly currency: string;
}

/**
 * The resolved template binding a WhatsApp preview produced (present only for a WhatsApp channel with
 * no blockers). There is no rendered body: WhatsApp content lives in a Meta-approved template, so what
 * a preview can show is which template it binds to and the ORDERED positional parameters — Meta body
 * params carry no names on the wire, so this array's order is what decides where each value lands.
 */
export interface WhatsappPreview {
  readonly templateName: string;
  readonly templateLanguage: string;
  readonly templateCategory: "marketing" | "utility" | "authentication";
  readonly parameters: readonly string[];
  readonly costMinor: string;
  readonly currency: string;
}

/**
 * Result of previewing a released definition — equals what a subsequent send would render. `channel`
 * discriminates the rendered result: `preview` is set for SMS, `emailPreview` for Email,
 * `whatsappPreview` for WhatsApp; the others are null. An SMS consumer written before the other
 * channels shipped reads `preview` and is unaffected.
 */
export interface MessagePreview {
  readonly versionId: string;
  readonly channel: "sms" | "email" | "whatsapp";
  readonly environment: "sandbox" | "live";
  readonly resolvedLocale: string;
  readonly blockers: readonly PreviewBlocker[];
  readonly warnings: readonly PreviewBlocker[];
  readonly eligible: boolean;
  readonly sender: {
    readonly senderId: string;
    readonly status:
      | "sandbox"
      | "active"
      | "pending"
      | "rejected"
      | "unregistered"
      | "not_evaluated";
  };
  readonly messageClass: "transactional" | "promotional";
  readonly preview: SmsPreview | null;
  readonly emailPreview: EmailPreview | null;
  readonly whatsappPreview: WhatsappPreview | null;
}

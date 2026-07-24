import { z } from "zod";
import {
  emailVariantContent,
  localeTag,
  messageChannel,
  messageVariantContent,
  smsVariantContent,
} from "./message-definition-content.js";
import { withoutDuplicateDefaultLocale } from "./message-definition-locale.js";
import { variableSchema } from "./message-definition-variable-schema.js";

// Re-export the per-channel variant content + the variable-schema subset so `./message-definitions.js`
// (and the package index) keep exporting these names after the split for the file-length guard.
export * from "./message-definition-content.js";
export * from "./message-definition-variable-schema.js";

/**
 * MANAGED MESSAGE DEFINITIONS contracts (SDK-003). Shapes + validation only — no logic (the
 * compatibility algorithm lives in @app/domain). Encodes the stable-key grammar and the portable,
 * closed variable-schema subset locked in docs/sdk/sdk-003-slice0-design.md.
 */

// ---- Stable key (slice-0 §1) --------------------------------------------------------------------
// Dotted lowercase; segment = [a-z][a-z0-9]*(-[a-z0-9]+)*; <=8 segments; <=128 chars; reserved
// `fabric.` prefix rejected. Uniqueness is per application and case-insensitive (enforced in the DB).
const STABLE_KEY_SEGMENT = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const STABLE_KEY_RE = new RegExp(
  `^${STABLE_KEY_SEGMENT}(?:\\.${STABLE_KEY_SEGMENT})*$`,
);

export const stableKey = z
  .string()
  .min(1)
  .max(128)
  .regex(STABLE_KEY_RE, "invalid_stable_key")
  .refine((k) => k.split(".").length <= 8, "stable_key_too_many_segments")
  .refine((k) => !k.toLowerCase().startsWith("fabric."), "stable_key_reserved");
export type StableKey = z.infer<typeof stableKey>;

// ---- Resource DTOs ------------------------------------------------------------------------------
export const messageDefinitionStatus = z.enum(["draft", "active", "archived"]);
export type MessageDefinitionStatus = z.infer<typeof messageDefinitionStatus>;

export const messageDefinition = z.object({
  id: z.string().uuid(),
  application_id: z.string().uuid(),
  key: stableKey,
  status: messageDefinitionStatus,
  created_at: z.string(),
  updated_at: z.string(),
});
export type MessageDefinition = z.infer<typeof messageDefinition>;

// Channel-polymorphic version (SDK-007 slice 4c). `channel` is the authoritative discriminant (the
// version row's column); `content` is the matching variant (SMS or Email). Consumers narrow on
// `channel` — the content union can't self-discriminate, so read `channel` then treat `content` as the
// corresponding variant (the same channel-guarded pattern the render/preview path uses).
export const messageDefinitionVersion = z.object({
  id: z.string().uuid(),
  definition_id: z.string().uuid(),
  version: z.int().min(1),
  channel: messageChannel,
  variable_schema: variableSchema,
  content: messageVariantContent,
  default_locale: localeTag,
  created_at: z.string(),
});
export type MessageDefinitionVersion = z.infer<typeof messageDefinitionVersion>;

export const messageDefinitionRelease = z.object({
  id: z.string().uuid(),
  environment_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  version_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MessageDefinitionRelease = z.infer<typeof messageDefinitionRelease>;

export const messageDefinitionSenderBinding = z.object({
  id: z.string().uuid(),
  environment_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  sender_id: z.string().trim().min(1).max(11),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MessageDefinitionSenderBinding = z.infer<
  typeof messageDefinitionSenderBinding
>;

export const definitionEnvironment = z.enum(["sandbox", "live"]);
export type DefinitionEnvironment = z.infer<typeof definitionEnvironment>;

// An SMS sender id (sender-ID string). Required for the SMS channel; the Email channel has no sender
// id — its sender identity is the `from` on the content, and its sending-domain binding is deferred
// (SDK-007 slice 4b/4c).
const smsSenderId = z.string().trim().min(1).max(11);

// Author a draft (management path, SDK-003 slice 4; SDK-007 slice 4c makes it channel-discriminated).
// Content + schema authored together. Targets the workspace default application unless application_id
// is given. `channel` selects the variant + whether a `sender_id` is required.
export const createMessageDefinitionRequest = z
  .discriminatedUnion("channel", [
    z.object({
      channel: z.literal("sms"),
      application_id: z.string().uuid().optional(),
      key: stableKey,
      variable_schema: variableSchema,
      content: smsVariantContent,
      default_locale: localeTag,
      sender_id: smsSenderId,
    }),
    z.object({
      channel: z.literal("email"),
      application_id: z.string().uuid().optional(),
      key: stableKey,
      variable_schema: variableSchema,
      content: emailVariantContent,
      default_locale: localeTag,
    }),
  ])
  .superRefine(withoutDuplicateDefaultLocale);
export type CreateMessageDefinitionRequest = z.infer<
  typeof createMessageDefinitionRequest
>;

// Add a new immutable version to an existing definition. Rejected server-side if the schema change is
// breaking versus the latest version (a breaking change must use a new stable key — slice-0 §3), or if
// the channel differs from the definition's existing channel (channel is immutable across versions).
export const addMessageDefinitionVersionRequest = z
  .discriminatedUnion("channel", [
    z.object({
      channel: z.literal("sms"),
      variable_schema: variableSchema,
      content: smsVariantContent,
      default_locale: localeTag,
      sender_id: smsSenderId,
    }),
    z.object({
      channel: z.literal("email"),
      variable_schema: variableSchema,
      content: emailVariantContent,
      default_locale: localeTag,
    }),
  ])
  .superRefine(withoutDuplicateDefaultLocale);
export type AddMessageDefinitionVersionRequest = z.infer<
  typeof addMessageDefinitionVersionRequest
>;

// Publish an immutable version to an environment. SDK-003 keeps live promotion absent — only sandbox
// is accepted here; the API rejects `live` until the live path lands (SDK-006).
export const publishMessageDefinitionRequest = z.object({
  environment: definitionEnvironment,
  version_id: z.string().uuid(),
});
export type PublishMessageDefinitionRequest = z.infer<
  typeof publishMessageDefinitionRequest
>;

export const messageDefinitionState = z.object({
  definition: messageDefinition,
  latest_version: messageDefinitionVersion.nullable(),
  releases: z.array(messageDefinitionRelease),
  sender_bindings: z.array(messageDefinitionSenderBinding),
});
export type MessageDefinitionState = z.infer<typeof messageDefinitionState>;

export const listMessageDefinitionsResponse = z.object({
  definitions: z.array(messageDefinitionState),
});
export type ListMessageDefinitionsResponse = z.infer<
  typeof listMessageDefinitionsResponse
>;

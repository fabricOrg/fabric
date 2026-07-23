import type {
  EmailVariantContent,
  MessageChannel,
  MessageClass,
  MessageDefinitionState,
  SmsTemplate,
  SmsVariantContent,
} from "@app/contracts";
import {
  type AuthoringVariable,
  supportsVisualSchema,
  templateToDefinitionDraft,
  variablesFromSchema,
} from "./definition-authoring";
import { type EmailLocaleDraft, emailLocalesToDrafts } from "./email-authoring";
import type { LocalizedVariantDraft } from "./localized-variants-editor";

export interface DefinitionDraft {
  channel: MessageChannel;
  key: string;
  variables: AuthoringVariable[];
  locale: string;
  schemaText: string;
  advancedSchema: boolean;
  // SMS content
  body: string;
  messageClass: MessageClass;
  senderId: string;
  localizedVariants: LocalizedVariantDraft[];
  // Email content
  from: string;
  subject: string;
  text: string;
  html: string;
  emailLocalizedVariants: EmailLocaleDraft[];
}

const EMPTY_EMAIL = { from: "", subject: "", text: "", html: "" };
const EMPTY_SMS = {
  body: "",
  messageClass: "transactional" as const,
  senderId: "",
};

export function initialDefinitionDraft(
  template?: SmsTemplate,
  definition?: MessageDefinitionState,
): DefinitionDraft {
  const version = definition?.latest_version;

  if (definition && version?.channel === "email") {
    const content = version.content as EmailVariantContent;
    return {
      channel: "email",
      key: definition.definition.key,
      variables: variablesFromSchema(version.variable_schema),
      locale: version.default_locale,
      schemaText: JSON.stringify(version.variable_schema, null, 2),
      advancedSchema: !supportsVisualSchema(version.variable_schema),
      ...EMPTY_SMS,
      localizedVariants: [],
      from: content.from ?? "",
      subject: content.subject,
      text: content.text ?? "",
      html: content.html ?? "",
      emailLocalizedVariants: emailLocalesToDrafts(content),
    };
  }

  if (definition && version?.channel === "sms") {
    const content = version.content as SmsVariantContent;
    return {
      channel: "sms",
      key: definition.definition.key,
      variables: variablesFromSchema(version.variable_schema),
      locale: version.default_locale,
      schemaText: JSON.stringify(version.variable_schema, null, 2),
      advancedSchema: !supportsVisualSchema(version.variable_schema),
      body: content.body,
      messageClass: content.class,
      senderId: definition.sender_bindings[0]?.sender_id ?? "",
      localizedVariants: Object.entries(content.locales).map(
        ([locale, localeContent]) => ({
          id: crypto.randomUUID(),
          locale,
          body: localeContent.body,
        }),
      ),
      ...EMPTY_EMAIL,
      emailLocalizedVariants: [],
    };
  }

  if (template) {
    return {
      channel: "sms",
      ...templateToDefinitionDraft(template),
      locale: "en",
      schemaText: "",
      advancedSchema: false,
      messageClass: template.class,
      senderId: "",
      localizedVariants: [],
      ...EMPTY_EMAIL,
      emailLocalizedVariants: [],
    };
  }

  return {
    channel: "sms",
    key: "",
    variables: [],
    locale: "en",
    schemaText: "",
    advancedSchema: false,
    ...EMPTY_SMS,
    localizedVariants: [],
    ...EMPTY_EMAIL,
    emailLocalizedVariants: [],
  };
}

import type {
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
import type { LocalizedVariantDraft } from "./localized-variants-editor";

export interface DefinitionDraft {
  key: string;
  body: string;
  variables: AuthoringVariable[];
  locale: string;
  schemaText: string;
  advancedSchema: boolean;
  messageClass: MessageClass;
  senderId: string;
  localizedVariants: LocalizedVariantDraft[];
}

export function initialDefinitionDraft(
  template?: SmsTemplate,
  definition?: MessageDefinitionState,
): DefinitionDraft {
  // SMS-only for now: the visual/edit draft is SMS-shaped. Email editing (its own content fields) is
  // SDK-007 slice 4e — an email version is authored via the API and shown read-only on the page, so the
  // Edit dialog (the only caller of this branch) is hidden for email.
  const version = definition?.latest_version;
  if (version && version.channel === "sms") {
    const content = version.content as SmsVariantContent;
    return {
      key: definition.definition.key,
      body: content.body,
      variables: variablesFromSchema(version.variable_schema),
      locale: version.default_locale,
      schemaText: JSON.stringify(version.variable_schema, null, 2),
      advancedSchema: !supportsVisualSchema(version.variable_schema),
      messageClass: content.class,
      senderId: definition.sender_bindings[0]?.sender_id ?? "",
      localizedVariants: Object.entries(content.locales).map(
        ([locale, localeContent]) => ({
          id: crypto.randomUUID(),
          locale,
          body: localeContent.body,
        }),
      ),
    };
  }
  if (template) {
    return {
      ...templateToDefinitionDraft(template),
      locale: "en",
      schemaText: "",
      advancedSchema: false,
      messageClass: template.class,
      senderId: "",
      localizedVariants: [],
    };
  }
  return {
    key: "",
    body: "",
    variables: [],
    locale: "en",
    schemaText: "",
    advancedSchema: false,
    messageClass: "transactional",
    senderId: "",
    localizedVariants: [],
  };
}

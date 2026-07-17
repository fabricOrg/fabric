import type {
  MessageClass,
  MessageDefinitionState,
  SmsTemplate,
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
  if (definition?.latest_version) {
    return {
      key: definition.definition.key,
      body: definition.latest_version.content.body,
      variables: variablesFromSchema(definition.latest_version.variable_schema),
      locale: definition.latest_version.default_locale,
      schemaText: JSON.stringify(
        definition.latest_version.variable_schema,
        null,
        2,
      ),
      advancedSchema: !supportsVisualSchema(
        definition.latest_version.variable_schema,
      ),
      messageClass: definition.latest_version.content.class,
      senderId: definition.sender_bindings[0]?.sender_id ?? "",
      localizedVariants: Object.entries(
        definition.latest_version.content.locales,
      ).map(([locale, content]) => ({
        id: crypto.randomUUID(),
        locale,
        body: content.body,
      })),
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

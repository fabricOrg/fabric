/**
 * The locales the authoring surfaces offer by default.
 *
 * Ghana and Nigeria are the served markets, and a locale is only worth offering if someone will
 * actually author content for it — an exhaustive BCP-47 list would be a worse control than the text
 * box it replaced. `LocaleSelect` still keeps any tag a record already holds selectable, so this
 * shortlist narrows the common path without blocking a valid one.
 *
 * One list, imported by every locale picker, so two screens cannot drift into offering different
 * answers to the same question.
 */
export const AUTHORING_LOCALES = [
  "en",
  "en-GH",
  "en-NG",
  "fr",
  "fr-FR",
] as const;

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";

/**
 * Radix cannot hold an empty-string value, but "no locale chosen" is a real state that has to reach
 * the caller as `""`. The sentinel lives here so no call site invents its own.
 */
const DEFAULT_SENTINEL = "__default__";

/**
 * The one locale picker.
 *
 * Locale was a free-text input in two places, which asked the reader to recall BCP-47 tags and then
 * failed the request when they misremembered. Replacing it per screen produced two selects with two
 * sets of rules for the same question, so the control is shared instead — and with it the two rules
 * that are easy to get wrong:
 *
 *   1. A value already held is ALWAYS selectable, even when it is outside `locales`. A form must be
 *      able to represent what it was opened with; otherwise editing an old record silently rewrites it.
 *   2. "Default" is offered only where a locale is genuinely optional, and it round-trips as `""`.
 *
 * `locales` is the caller's business: the authoring form offers the markets we serve, while a release
 * check offers only the locales that definition actually has.
 */
export function LocaleSelect({
  id,
  value,
  onChange,
  locales,
  allowDefault = false,
  placeholder = "Select a locale",
  disabled,
}: {
  id?: string;
  /** `""` means "not chosen" — rendered as Default when `allowDefault`. */
  value: string;
  onChange: (locale: string) => void;
  locales: readonly string[];
  /** Adds a "Default" option that round-trips as `""`. */
  allowDefault?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const options =
    value && !locales.includes(value) ? [...locales, value] : locales;
  return (
    <Select
      value={value || (allowDefault ? DEFAULT_SENTINEL : "")}
      onValueChange={(next) => onChange(next === DEFAULT_SENTINEL ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowDefault ? (
          <SelectItem value={DEFAULT_SENTINEL}>Default</SelectItem>
        ) : null}
        {options.map((locale) => (
          <SelectItem key={locale} value={locale}>
            {locale}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

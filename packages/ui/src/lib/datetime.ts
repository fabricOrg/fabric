/**
 * The product's date and time formats, in one place.
 *
 * Before this, ~32 call sites each re-derived their own `toLocaleString` options and they disagreed
 * in ways users could see: the same log timestamp appeared as `Aug 2, 02:45 PM` in one table and
 * `8/2/2026, 2:45:12 PM` in another, because several sites called `toLocaleString()` with NO locale
 * and no options at all. Those bare calls are the worst case — the output follows whatever locale the
 * *rendering environment* has, which for a server component is the container's, not the reader's.
 *
 * Every format here therefore pins the `en` locale explicitly. A missing or unparseable value renders
 * the `fallback` (an em dash by default) instead of the string `"Invalid Date"`.
 *
 * KNOWN GAP, deliberately not changed here: no format pins a `timeZone`, so a timestamp rendered in a
 * client component shows the reader's local zone while the same timestamp rendered in a server
 * component shows the container's (UTC in every deployed environment). Consolidating the formats does
 * not fix that — it makes it fixable, since the decision now lives in one file. Choosing a zone is a
 * product call (the workspace's? the reader's? UTC for provider-log correlation?) and pinning one
 * would silently change what every existing screen displays.
 */

const LOCALE = "en";

export type DateInput = string | number | Date | null | undefined;

interface FormatOptions {
  /** Rendered when the value is absent or unparseable. */
  readonly fallback?: string;
}

/** Parse defensively: an API can hand us null, and a bad string must not render "Invalid Date". */
function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function format(
  value: DateInput,
  options: Intl.DateTimeFormatOptions,
  fallback: string,
): string {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleString(LOCALE, options);
}

/** `Aug 2, 2026` — a calendar date where the year matters (created, submitted, expires). */
export function formatDate(value: DateInput, opts: FormatOptions = {}): string {
  return format(
    value,
    { month: "short", day: "numeric", year: "numeric" },
    opts.fallback ?? "—",
  );
}

/** `Aug 2` — a date inside a known year: chart axes, expiry chips, dense ledger rows. */
export function formatDayMonth(
  value: DateInput,
  opts: FormatOptions = {},
): string {
  return format(
    value,
    { month: "short", day: "numeric" },
    opts.fallback ?? "—",
  );
}

/** `Sat, Aug 2` — day separators in a conversation, where the weekday is the orienting detail. */
export function formatWeekdayDate(
  value: DateInput,
  opts: FormatOptions = {},
): string {
  return format(
    value,
    { weekday: "short", month: "short", day: "numeric" },
    opts.fallback ?? "—",
  );
}

/** `02:45 PM` — a time inside a known day. */
export function formatTime(value: DateInput, opts: FormatOptions = {}): string {
  return format(
    value,
    { hour: "2-digit", minute: "2-digit" },
    opts.fallback ?? "—",
  );
}

/** `Aug 2, 02:45 PM` — the log/table default: recent events, where the year is noise. */
export function formatDateTime(
  value: DateInput,
  opts: FormatOptions = {},
): string {
  return format(
    value,
    { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
    opts.fallback ?? "—",
  );
}

/**
 * `2026-08-02 15:14` — an EVIDENCE timestamp, in UTC, read straight off the ISO string.
 *
 * The odd one out here, on purpose. The audit log, the proposal queue and the tenant list are
 * correlated against provider logs and server logs by an operator, so a fixed, sortable, zone-explicit
 * stamp is worth more there than a friendly local one — and unlike every other format in this file it
 * cannot disagree between a server and a client render, because no locale or zone is consulted.
 *
 * It exists so that intent is recorded rather than hand-sliced at three call sites (`iso.slice(0, 10)`
 * reads like a typo, not a decision). Do NOT reach for it on customer surfaces: showing a Ghanaian
 * merchant a UTC stamp with no zone label is worse than showing them their own clock.
 */
export function formatUtcTimestamp(
  value: DateInput,
  opts: FormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return opts.fallback ?? "—";
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** `2026-08-02` — the date half of an evidence timestamp, same UTC reasoning. */
export function formatUtcDate(
  value: DateInput,
  opts: FormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return opts.fallback ?? "—";
  return date.toISOString().slice(0, 10);
}

/**
 * `Aug 2, 2026, 02:45 PM` — detail surfaces and audit evidence, where a reader may be looking at
 * something months old and the year is load-bearing.
 */
export function formatDateTimeFull(
  value: DateInput,
  opts: FormatOptions = {},
): string {
  return format(
    value,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    opts.fallback ?? "—",
  );
}

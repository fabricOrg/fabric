import { pageQuery } from "@app/contracts";
import { invalidRequest } from "./api-error.js";

/**
 * Opaque keyset cursor for the public list endpoints — names the last row of the previous page
 * on the (created_at DESC, id DESC) sort.
 *
 * `createdAt` is the MICROSECOND-precise timestamp as rendered by Postgres
 * (to_char … 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), never a JS Date: timestamptz stores µs while
 * Date holds only ms, and a ms-truncated cursor both skips sub-ms neighbours and breaks the
 * id tiebreak for rows written in the same transaction (identical created_at — e.g. a batch).
 * Queries MUST compare it via `created_at < ${value}::text::timestamptz` — the postgres.js driver
 * binds the ISO string so that a bare `::timestamptz` re-truncates to millisecond; the text hop
 * forces full-precision parsing. Verified against a real Postgres keyset walk.
 */
export interface KeysetCursor {
  readonly createdAt: string;
  readonly id: string;
}

/** Matches exactly the to_char rendering above — also guarantees the value contains no `|`. */
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** SQL fragment (for tagged-template use) that renders created_at in the cursor format. */
export const CURSOR_TS_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(value: string): KeysetCursor {
  // Buffer.from never throws on malformed base64url — it silently decodes junk, so the format
  // checks below are the actual fail-closed gate.
  const raw = Buffer.from(value, "base64url").toString("utf8");
  const separator = raw.indexOf("|");
  if (separator <= 0 || separator === raw.length - 1) {
    throw invalidCursor();
  }
  const createdAt = raw.slice(0, separator);
  if (!CURSOR_TIMESTAMP.test(createdAt)) {
    throw invalidCursor();
  }
  // The id may itself contain any characters (including `|`): only the FIRST separator splits.
  return { createdAt, id: raw.slice(separator + 1) };
}

function invalidCursor() {
  return invalidRequest(
    "invalid_cursor",
    "The cursor is not valid. Pass a next_cursor value exactly as returned.",
    "cursor",
  );
}

export interface PageInput {
  limit: number;
  before?: KeysetCursor;
}

/** Shared page-input parsing for list controllers: limit defaults to 50, cursor fails closed. */
export function parsePageQuery(query: Record<string, unknown>): PageInput {
  const parsed = pageQuery.safeParse(query);
  if (!parsed.success) {
    throw invalidRequest(
      "invalid_page",
      "`limit` must be an integer between 1 and 100.",
      "limit",
    );
  }
  return {
    limit: parsed.data.limit ?? 50,
    ...(parsed.data.cursor ? { before: decodeCursor(parsed.data.cursor) } : {}),
  };
}

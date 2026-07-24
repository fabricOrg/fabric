import { pageQuery } from "@app/contracts";
import { invalidRequest } from "./api-error.js";

/**
 * Opaque keyset cursor for the public list endpoints — names the last row of the previous page
 * on the (created_at DESC, id DESC) sort. Encoded so clients treat it as a token, not a schema;
 * a malformed or hand-built value fails closed as invalid_cursor.
 */
export interface KeysetCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(
    `${cursor.createdAt.toISOString()}|${cursor.id}`,
    "utf8",
  ).toString("base64url");
}

export function decodeCursor(value: string): KeysetCursor {
  const raw = Buffer.from(value, "base64url").toString("utf8");
  const separator = raw.indexOf("|");
  if (separator <= 0 || separator === raw.length - 1) {
    throw invalidCursor();
  }
  const createdAt = new Date(raw.slice(0, separator));
  if (Number.isNaN(createdAt.getTime())) {
    throw invalidCursor();
  }
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

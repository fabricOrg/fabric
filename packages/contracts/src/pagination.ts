// Cursor pagination for the public list endpoints. Keyset on (created_at DESC, id DESC) — the
// cursor is an opaque token minted by the API (never constructed by clients) naming the last row
// of the previous page. `next_cursor` is null on the final page, so clients loop `while (cursor)`.
import { z } from "zod";

/** Query params accepted by paginated GET lists. Limit defaults server-side to 50. */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});
export type PageQuery = z.infer<typeof pageQuery>;

/** Opaque continuation token; null when there is no further page. */
export const nextCursor = z.string().nullable();

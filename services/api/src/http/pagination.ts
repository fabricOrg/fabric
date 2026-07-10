/**
 * Parse the standard `?limit&cursor` query into the opts every paginated service.list() takes.
 * One place so every control-plane list endpoint reads pagination identically (clamping of limit
 * itself lives in @app/db clampLimit, applied service-side).
 */
export function pageOpts(
  limit?: string,
  cursor?: string,
): { limit?: number; cursor?: string } {
  const parsed = limit ? Number(limit) : undefined;
  return {
    ...(parsed !== undefined && Number.isFinite(parsed)
      ? { limit: parsed }
      : {}),
    ...(cursor ? { cursor } : {}),
  };
}

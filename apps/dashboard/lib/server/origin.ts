import "server-only";

export function hasTrustedOrigin(request: Request): boolean {
  const expected = process.env.DASHBOARD_BASE_URL;
  const origin = request.headers.get("origin");
  return Boolean(expected && origin === expected);
}

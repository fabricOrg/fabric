import "server-only";

export function hasTrustedOrigin(request: Request): boolean {
  const expected = process.env.ADMIN_CONSOLE_BASE_URL;
  const origin = request.headers.get("origin");
  return Boolean(expected && origin === expected);
}

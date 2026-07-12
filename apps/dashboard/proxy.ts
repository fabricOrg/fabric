import { type NextRequest, NextResponse } from "next/server";

const EDGE_HEADER = "x-fabric-edge-secret";

export function proxy(request: NextRequest): NextResponse {
  const expected = process.env.EDGE_SHARED_SECRET?.trim();
  const edgeAllowed =
    !expected ||
    isLocalHealthCheck(request) ||
    request.headers.get(EDGE_HEADER) === expected;
  if (!edgeAllowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  // Expose the current pathname to Server Components so requireDashboardSession() can build the
  // /auth/refresh?return_to=… hop — a reload that refreshes the access token returns the user to the
  // page they were on, not the home route.
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

function isLocalHealthCheck(request: NextRequest): boolean {
  if (request.nextUrl.pathname !== "/healthz") return false;
  const host = request.headers.get("host");
  return (
    host?.startsWith("127.0.0.1:") === true ||
    host?.startsWith("localhost:") === true ||
    host === "127.0.0.1" ||
    host === "localhost"
  );
}

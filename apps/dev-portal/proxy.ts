import { type NextRequest, NextResponse } from "next/server";

const EDGE_HEADER = "x-fabric-edge-secret";

export function proxy(request: NextRequest): NextResponse {
  const expected = process.env.EDGE_SHARED_SECRET?.trim();
  if (!expected || isLocalHealthCheck(request)) {
    return NextResponse.next();
  }
  if (request.headers.get(EDGE_HEADER) === expected) {
    return NextResponse.next();
  }
  return new NextResponse("Forbidden", { status: 403 });
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

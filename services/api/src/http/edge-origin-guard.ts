import { readSingleHeader, secretsMatch } from "./shared-secret.js";

const EDGE_HEADER = "x-fabric-edge-secret";

interface EdgeRequest {
  headers: Record<string, string | string[] | undefined>;
  url: string;
}

export function edgeOriginAllowed(
  request: EdgeRequest,
  expectedSecret: string | undefined,
): boolean {
  const expected = expectedSecret?.trim();
  if (!expected) return true;
  if (isLocalHealthCheck(request)) return true;
  return secretsMatch(readSingleHeader(request.headers[EDGE_HEADER]), expected);
}

function isLocalHealthCheck(request: EdgeRequest): boolean {
  if (request.url !== "/health") return false;
  const host = readSingleHeader(request.headers.host);
  return (
    host?.startsWith("127.0.0.1:") === true ||
    host?.startsWith("localhost:") === true ||
    host === "127.0.0.1" ||
    host === "localhost"
  );
}

import { runAction, securityHeaders } from "../playground-core.mjs";

/** Vercel serverless entry — same contract as the local server's POST /api/run. */
export default async function handler(request, response) {
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.setHeader(key, value);
  }
  if (request.method !== "POST") {
    response.statusCode = 404;
    return response.end(JSON.stringify({ error: "Not found" }));
  }
  const body =
    typeof request.body === "object" && request.body ? request.body : {};
  const { status, payload } = await runAction(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload, null, 2));
}

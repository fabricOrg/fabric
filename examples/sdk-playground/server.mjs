import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { runAction, securityHeaders } from "./playground-core.mjs";

const port = Number(process.env.PORT ?? 3400);
const index = await readFile(
  new URL("./public/index.html", import.meta.url),
  "utf8",
);

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/")
    return send(response, 200, index, "text/html; charset=utf-8");
  if (request.method === "GET" && request.url === "/healthz")
    return json(response, 200, { status: "ok" });
  if (request.method !== "POST" || request.url !== "/api/run")
    return json(response, 404, { error: "Not found" });
  try {
    const { status, payload } = await runAction(
      JSON.parse(await readBody(request)),
    );
    return json(response, status, payload);
  } catch (error) {
    return json(response, 400, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}).listen(port, "0.0.0.0", () =>
  console.log(`Fabric SDK Playground listening on port ${port}`),
);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const value = Buffer.concat(chunks).toString("utf8");
  if (value.length > 100_000) throw new Error("Request is too large.");
  return value;
}
function json(response, status, value) {
  return send(
    response,
    status,
    JSON.stringify(value, null, 2),
    "application/json",
  );
}
function send(response, status, value, type) {
  response.writeHead(status, { "content-type": type, ...securityHeaders });
  response.end(value);
}

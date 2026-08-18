// One-command API reference viewer.
//
// `pnpm docs` -> serves the committed OpenAPI artifact with Scalar on http://localhost:4000 and
// opens a browser. No API running, no database, no credentials, no auth prompt.
//
// WHY THIS EXISTS SEPARATELY FROM `/docs`. The API's own `/docs` route serves the same document but
// is gated on OPERATOR_TOKEN and fails closed, because it describes `/internal/admin/*` — kill
// switches, impersonation, wallet adjustment. That gate is right for a deployed service and wrong
// for "I want to look at the spec on my laptop": it would mean setting an env var, booting the API,
// and answering a Basic-auth prompt. This reads the committed file instead, so there is nothing to
// configure and nothing to get wrong.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

const PORT = Number(process.env.DOCS_PORT ?? 4000);
const which = process.argv.includes("--public") ? "public" : "internal";
const FILE = resolve(
  process.cwd(),
  which === "public"
    ? "docs/api/openapi.json"
    : "docs/api/openapi.internal.json",
);

if (!existsSync(FILE)) {
  console.error(`No artifact at ${FILE}.\nRun: pnpm openapi:generate`);
  process.exit(1);
}

const spec = readFileSync(FILE, "utf8");
const { info, paths } = JSON.parse(spec);

const page = `<!doctype html>
<html>
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${info.title}</title></head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.65.1"
            integrity="sha384-NAMzfHXRsxRYhcKmRnZGVLvlBeXTWtpYd0jWgeZ7fk89X95GIJBK1H4bUwkP4IZJ"
            crossorigin="anonymous"></script>
    <script>Scalar.createApiReference('#app', { url: '/openapi.json' });</script>
  </body>
</html>`;

createServer((req, res) => {
  if (req.url?.startsWith("/openapi.json")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(spec);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
  // BIND LOCALHOST ONLY. Without a host, node listens on 0.0.0.0 — and the default artifact here is
  // the INTERNAL one: every /internal/* path, the three staff/service header names, the env-var
  // names. On any shared or café network that made the document `DocsAccessGuard` exists to protect
  // available to anyone who guessed the port. This viewer has no gate by design, so the gate is the
  // interface it binds.
}).listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  ${info.title}`);
  console.log(`  ${Object.keys(paths).length} paths  ·  ${which} artifact\n`);
  console.log(`  ${url}\n`);
  console.log("  Ctrl+C to stop.\n");
  // Best effort: a failed browser launch must not kill the server — the url is printed above.
  const opener =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the printed url is the fallback */
  }
});

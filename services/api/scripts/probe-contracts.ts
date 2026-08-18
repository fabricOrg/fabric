import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discover } from "./probe-discover.js";

/**
 * END-TO-END CONTRACT PROBE — calls every documented GET against a running API and reports anything
 * that is not a 2xx.
 *
 * WHY THIS IS THE REAL TEST OF THE SPECIFICATION. `openapi:check` proves the document matches the
 * bindings, and the unit tests prove the generator behaves. Neither proves the document matches
 * REALITY. This does: with response validation strict (the default outside production), a
 * `500 response_contract_violation` means the published schema disagrees with what the endpoint
 * actually returns — the exact class of defect that let a dead CloudFront url and a missing
 * WhatsApp channel sit in the artifact for weeks.
 *
 *   pnpm contracts:probe        (with the API running)
 *
 * SELF-CONFIGURING. It reads ids from the database, mints its own tenant token through
 * /internal/identity/tenant-token, and creates a temporary API key which it revokes afterwards.
 * The only inputs are the ones a running API already needs:
 *   BFF_INTERNAL_TOKEN, OPERATOR_TOKEN   the values the API was started with
 *   DATABASE_URL_SUPER (or _APP)         to discover ids — normally already in .env
 *   PROBE_BASE_URL                       default http://localhost:3000
 *
 * It used to require five variables and a hand-built JSON map of path parameters, which meant only
 * whoever wrote the incantation could run it. A proof step nobody can reproduce is not a proof step.
 *
 * A route whose parameters cannot be resolved is reported as SKIPPED, never called with a nonsense
 * value — a 404 from a made-up id would look like a contract failure and is not one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = resolve(HERE, "../../../docs/api/openapi.internal.json");
const BASE = process.env.PROBE_BASE_URL ?? "http://localhost:3000";
let TENANT_TOKEN = "";
let API_KEY = "";
let IDS: Record<string, string> = {};

interface Operation {
  readonly security?: readonly Record<string, unknown>[];
}

function credentialsFor(
  operation: Operation,
  path: string,
): Record<string, string> {
  const schemes = (operation.security ?? []).flatMap((entry) =>
    Object.keys(entry),
  );
  if (schemes.includes("webhookToken"))
    return { "x-webhook-token": process.env.WEBHOOK_INGRESS_TOKEN ?? "" };
  if (schemes.includes("bffInternal"))
    return { "x-bff-token": process.env.BFF_INTERNAL_TOKEN ?? "" };
  if (schemes.includes("operatorToken"))
    return { "x-operator-token": process.env.OPERATOR_TOKEN ?? "" };
  if (schemes.includes("secretKey") || schemes.includes("tenantToken")) {
    // Token/commercial-offer routes refuse an API key BY DESIGN — a purchase must come from a
    // dashboard session. Everything else prefers the scoped key, which satisfies more routes.
    const sessionOnly = path.startsWith("/v1/tokens");
    const bearer = sessionOnly ? TENANT_TOKEN : API_KEY || TENANT_TOKEN;
    return bearer ? { authorization: `Bearer ${bearer}` } : {};
  }
  return {};
}

/**
 * `{id}` names a different resource on every route, so it resolves per PATH. Resolving it globally
 * is not a shortcut — it reported eleven healthy endpoints as broken when this was first run.
 */
function resolveId(path: string, name: string): string | undefined {
  if (name !== "id") return IDS[name];
  if (path.startsWith("/v1/sms/batches")) return IDS.batchId;
  if (path.startsWith("/v1/sms/")) return IDS.messageId;
  if (path.startsWith("/v1/email/") || path.includes("/emails/"))
    return IDS.emailId;
  if (path.startsWith("/v1/whatsapp/")) return IDS.whatsappId;
  if (path.startsWith("/v1/message-deliveries")) return IDS.deliveryId;
  if (path.startsWith("/v1/webhooks")) return IDS.webhookId;
  if (path.startsWith("/internal/admin/tenants")) return IDS.tenantId;
  return IDS.id;
}

/** Query parameters an endpoint legitimately requires. Supplying them is the difference between
 *  probing the CONTRACT and probing the argument checks in front of it. */
function queryFor(path: string): string {
  const query = new URLSearchParams();
  if (path.startsWith("/internal/tenants/")) query.set("env", "sandbox");
  if (path.includes("/privacy/tenants/"))
    query.set("msisdn", IDS.msisdn ?? "+233000000000");
  if (
    path === "/v1/api-keys" ||
    path === "/v1/applications" ||
    path === "/v1/message-definitions"
  )
    query.set("tenantId", IDS.tenantId ?? "");
  if (path.startsWith("/v1/message-deliveries")) {
    query.set("environment_id", IDS.environmentId ?? "");
    query.set("application_id", IDS.applicationId ?? "");
  }
  const rendered = query.toString();
  return rendered ? `?${rendered}` : "";
}

async function main(): Promise<void> {
  const context = await discover(BASE, process.env.BFF_INTERNAL_TOKEN ?? "");
  TENANT_TOKEN = context.tenantToken;
  API_KEY = context.apiKey;
  IDS = context.ids;
  try {
    await probe();
  } finally {
    await context.cleanup();
  }
}

async function probe(): Promise<void> {
  const spec = JSON.parse(readFileSync(SPEC, "utf8")) as {
    paths: Record<string, Record<string, Operation>>;
  };
  const ok: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  let contractViolations = 0;

  for (const [path, methods] of Object.entries(spec.paths)) {
    const operation = methods.get;
    if (!operation) continue;
    if (path.startsWith("/docs")) continue; // serves the artifact this probe reads

    const missing: string[] = [];
    const url = path.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = resolveId(path, name);
      if (!value) missing.push(name);
      return value ?? `{${name}}`;
    });
    if (missing.length > 0) {
      skipped.push(`${path}  (no value for: ${missing.join(", ")})`);
      continue;
    }

    try {
      const response = await fetch(`${BASE}${url}${queryFor(path)}`, {
        headers: {
          ...credentialsFor(operation, path),
          "x-actor-email": "probe@fabric.local",
          "x-actor-staff-id": IDS.staffId ?? "",
        },
      });
      if (response.ok) {
        ok.push(path);
        continue;
      }
      const body = await response.text();
      if (body.includes("response_contract_violation")) contractViolations += 1;
      failed.push(`${response.status}  ${path}\n      ${body.slice(0, 220)}`);
    } catch (error) {
      failed.push(`ERR  ${path}  ${String(error).slice(0, 160)}`);
    }
  }

  console.log(`\nOK        ${ok.length}`);
  console.log(`FAILED    ${failed.length}`);
  console.log(`SKIPPED   ${skipped.length}  (unresolvable path parameter)`);
  console.log(`\nCONTRACT VIOLATIONS: ${contractViolations}`);
  if (failed.length > 0) {
    console.log("\n--- failures ---");
    for (const line of failed) console.log(`  ${line}`);
  }
  if (skipped.length > 0) {
    console.log("\n--- skipped ---");
    for (const line of skipped) console.log(`  ${line}`);
  }

  // A CONTRACT violation fails the run. A 404 for a resource this environment does not have, or a
  // 401 for a credential it was not given, says nothing about the specification, so those are
  // reported and not failed.
  if (contractViolations > 0) process.exitCode = 1;

  // And so does proving NOTHING. `contractViolations` counts violations found, so it is zero both
  // when everything checked out and when nothing was ever checked — run this with the wrong
  // credentials and every route 401s to a clean exit 0. §12 defines proven as "returned 2xx"; a run
  // without a single 2xx has not met that bar and must not read as success.
  if (ok.length === 0) {
    console.error(
      "\nPROVED NOTHING: no documented GET returned 2xx. Check the API is running and that " +
        "BFF_INTERNAL_TOKEN / OPERATOR_TOKEN match the values it was started with.",
    );
    process.exitCode = 1;
  }
}

await main();

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
 *   pnpm --filter @app/api contracts:probe
 *
 * Needs a running API and credentials. Everything is read from the environment so no secret is
 * baked in:
 *   PROBE_BASE_URL            default http://localhost:3000
 *   PROBE_TENANT_TOKEN        Bearer token for /v1/* routes (mint via /internal/identity/tenant-token)
 *   PROBE_API_KEY             an application-scoped sk_* key; several routes require one
 *   BFF_INTERNAL_TOKEN        for /internal/*
 *   OPERATOR_TOKEN            for operator-guarded routes
 *   WEBHOOK_INGRESS_TOKEN     for /webhooks/dlr/*
 *   PROBE_IDS                 JSON map of path-parameter values (see resolveId)
 *
 * A route whose parameters cannot be resolved is reported as SKIPPED, never called with a nonsense
 * value — a 404 from a made-up id would look like a contract failure and is not one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = resolve(HERE, "../../../docs/api/openapi.internal.json");
const BASE = process.env.PROBE_BASE_URL ?? "http://localhost:3000";
const TENANT_TOKEN = process.env.PROBE_TENANT_TOKEN ?? "";
const API_KEY = process.env.PROBE_API_KEY ?? "";
const IDS: Record<string, string> = JSON.parse(process.env.PROBE_IDS ?? "{}");

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

  // Only a CONTRACT violation fails the run. A 404 for a resource this environment does not have,
  // or a 401 for a credential it was not given, says nothing about the specification.
  if (contractViolations > 0) process.exitCode = 1;
}

await main();

import { RequestMethod } from "@nestjs/common";
import type { ZodType } from "zod";
import { ROUTE_BINDINGS } from "./route-bindings.js";

/**
 * RESPONSE CONTRACTS AT RUNTIME — the same schemas the OpenAPI document publishes, used to check
 * what the API actually returns.
 *
 * This is what turns the specification from a description into a guarantee. Documenting a shape
 * proves nothing: the previous artifact documented a WhatsApp channel it did not have and a JSON
 * body for a CSV download. A contract that is published AND enforced cannot drift from the payload,
 * because the payload is checked against the published thing.
 *
 * It also gives QA one assumption to rely on: if a response reached the caller, it matched the
 * schema in the reference. A failing shape is a 500 in development, not a subtly wrong field that
 * surfaces three integrations later.
 */

const PATH_METADATA = "path";
const METHOD_METADATA = "method";

const METHOD_NAMES: Readonly<Record<number, string>> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.OPTIONS]: "OPTIONS",
  [RequestMethod.HEAD]: "HEAD",
};

function joinPath(prefix: unknown, suffix: unknown): string {
  const head = typeof prefix === "string" ? prefix : "";
  const tail = typeof suffix === "string" ? suffix : "";
  const segments = `${head}/${tail}`
    .split("/")
    .filter((segment) => segment.length > 0);
  return `/${segments.join("/")}`;
}

/**
 * The response schema for the handler serving this request, or null when the route has no response
 * contract (an acknowledged gap — see the binding files' `TODO(contract)` markers).
 *
 * Resolved from the SAME decorator metadata the generator reads, so the key here and the key in the
 * emitted document are produced the same way. A route whose binding key drifted would fail the
 * generator's coverage check long before it reached this lookup.
 */
export function responseContractFor(
  controllerClass: object,
  handler: object,
): ZodType | null {
  return bindingFor(controllerClass, handler)?.response ?? null;
}

/** The request-body contract for this handler, or null when the binding declares none. */
export function requestContractFor(
  controllerClass: object,
  handler: object,
): ZodType | null {
  return bindingFor(controllerClass, handler)?.request ?? null;
}

/**
 * The success media type this route's binding DECLARES, or null for the JSON default.
 *
 * Exists so the runtime honours the same declaration the document publishes. Before this,
 * `successContentType` was read only by the generator: the binding said `text/plain` for the Meta
 * challenge echo, the document said `text/plain`, and the interceptor wrapped it in JSON anyway —
 * so Meta's verbatim comparison would never have matched and webhook verification could not be
 * completed. The declaration has to bind both halves or it is decoration.
 */
export function successContentTypeFor(
  controllerClass: object,
  handler: object,
): string | null {
  return bindingFor(controllerClass, handler)?.successContentType ?? null;
}

/** The query-string contract for this handler, or null when the binding declares none. */
export function queryContractFor(
  controllerClass: object,
  handler: object,
): ZodType | null {
  return bindingFor(controllerClass, handler)?.query ?? null;
}

function bindingFor(controllerClass: object, handler: object) {
  const controllerPath = Reflect.getMetadata(PATH_METADATA, controllerClass);
  if (controllerPath === undefined) return null;
  const verb = Reflect.getMetadata(METHOD_METADATA, handler);
  if (typeof verb !== "number") return null;
  const method = METHOD_NAMES[verb];
  if (!method) return null;
  const path = joinPath(
    controllerPath,
    Reflect.getMetadata(PATH_METADATA, handler),
  );
  return ROUTE_BINDINGS[`${method} ${path}`] ?? null;
}

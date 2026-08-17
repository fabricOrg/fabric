import { enveloped } from "@app/contracts";
import { toRequestSchema, toResponseSchema } from "./openapi-schema.js";
import type {
  RouteBinding,
  RouteBindings,
  RouteVisibility,
} from "./route-binding.types.js";
import { type DiscoveredRoute, routeKey } from "./route-table.js";
import { INTERNAL_ONLY_SCHEMES, SECURITY_SCHEMES } from "./security-schemes.js";

/**
 * Assembles the OpenAPI 3.1 document from the router's real route list and the hand-written
 * bindings, and REFUSES to emit when the two disagree. That refusal is the point of the whole
 * pipeline: the previous generator could not tell a missing endpoint from a complete document.
 */

export interface BuildOptions {
  /** Which routes to include. The public artifact is publishable; the full one never is. */
  readonly include: readonly RouteVisibility[];
  readonly serverUrl: string;
  readonly title: string;
  readonly description: string;
  readonly version: string;
}

/** Every route returns the platform error envelope, so it is documented once, not 138 times. */
const ERROR_RESPONSE_REF = "#/components/schemas/ErrorEnvelope";

const ALWAYS_POSSIBLE_ERRORS: Readonly<Record<string, string>> = {
  "400": "Invalid request.",
  "401": "Missing or invalid credentials.",
  "429": "Rate limited. Retry after the interval in `Retry-After`.",
  "500": "Unexpected server error.",
};

export class BindingCoverageError extends Error {}

/**
 * Nest declares `:id`; OpenAPI wants `{id}`. Converting here rather than storing OpenAPI-shaped
 * paths in the bindings keeps the binding key identical to what the router reports, so a stale
 * binding is caught by string equality instead of by a normalisation bug.
 */
function toOpenApiPath(nestPath: string): string {
  return nestPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function pathParameters(nestPath: string): Record<string, unknown>[] {
  return [...nestPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

/**
 * A route with no binding is a BUILD FAILURE, not a warning. This is the check that would have
 * caught the WhatsApp channel shipping undocumented, and the reason it must never be downgraded to
 * a log line: a warning in CI output is a warning nobody reads.
 */
function assertCoverage(
  routes: readonly DiscoveredRoute[],
  bindings: RouteBindings,
): void {
  const known = new Set(routes.map(routeKey));
  const missing = routes.filter((route) => !bindings[routeKey(route)]);
  const orphaned = Object.keys(bindings).filter((key) => !known.has(key));

  if (missing.length === 0 && orphaned.length === 0) return;

  const lines: string[] = [];
  if (missing.length > 0) {
    lines.push(
      `${missing.length} route(s) have no OpenAPI binding. Add them to route-bindings.ts:`,
      ...missing.map(
        (route) =>
          `  ${routeKey(route)}   (${route.controller}.${route.handler})`,
      ),
    );
  }
  if (orphaned.length > 0) {
    lines.push(
      `${orphaned.length} binding(s) name a route that no longer exists. Remove them:`,
      ...orphaned.map((key) => `  ${key}`),
    );
  }
  throw new BindingCoverageError(lines.join("\n"));
}

function operationFor(
  binding: RouteBinding,
  nestPath: string,
  publicOnly: boolean,
): Record<string, unknown> {
  const parameters: Record<string, unknown>[] = pathParameters(nestPath);
  if (binding.query) {
    // Query contracts are documented as a single schema rather than exploded into one parameter per
    // key: the contract is validated as a whole (cross-field refinements included), and splitting it
    // would document constraints that no individual parameter actually carries.
    parameters.push({
      name: "query",
      in: "query",
      required: false,
      schema: toRequestSchema(binding.query),
      style: "form",
      explode: true,
    });
  }

  const successType = binding.successContentType ?? "application/json";
  const isJson = successType === "application/json";
  const responses: Record<string, unknown> = {
    [String(binding.successStatus ?? 200)]: {
      description: "Success.",
      ...(binding.response
        ? {
            content: {
              [successType]: {
                // JSON successes are wrapped by ResponseEnvelopeInterceptor at runtime, so the
                // document wraps them too. Applying it HERE rather than in each binding is what
                // keeps the spec and the interceptor from ever disagreeing.
                schema: toResponseSchema(
                  isJson ? enveloped(binding.response) : binding.response,
                ),
              },
            },
          }
        : binding.successContentType
          ? // A declared non-JSON type with no zod contract is still worth emitting: the media type
            // is the part a caller must get right, and claiming nothing is better than claiming JSON.
            { content: { [successType]: { schema: { type: "string" } } } }
          : {}),
    },
  };
  for (const [status, description] of Object.entries(ALWAYS_POSSIBLE_ERRORS)) {
    responses[status] = errorResponse(description);
  }
  for (const status of binding.errorStatuses ?? []) {
    responses[String(status)] = errorResponse(
      "See `error.code` for the reason.",
    );
  }

  return {
    summary: binding.summary,
    ...(binding.description ? { description: binding.description } : {}),
    tags: [...binding.tags],
    ...(binding.deprecated ? { deprecated: true } : {}),
    security: securityFor(binding, publicOnly),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(binding.request
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: toRequestSchema(binding.request) },
            },
          },
        }
      : {}),
    responses,
  };
}

/**
 * The security list for an operation. In the PUBLIC artifact, staff/service schemes are removed —
 * see INTERNAL_ONLY_SCHEMES for why accuracy to the wrong audience is the problem. Never returns an
 * empty list for a route that declares credentials: if stripping would empty it, the original is
 * kept, because "no security" is a far worse lie than an over-broad one.
 */
function securityFor(
  binding: RouteBinding,
  publicOnly: boolean,
): Record<string, unknown>[] {
  const asEntries = (schemes: readonly string[]) =>
    schemes.map((scheme) => (scheme === "none" ? {} : { [scheme]: [] }));
  if (!publicOnly) return asEntries(binding.security);
  const customerFacing = binding.security.filter(
    (scheme) => !INTERNAL_ONLY_SCHEMES.has(scheme),
  );
  return asEntries(
    customerFacing.length > 0 ? customerFacing : binding.security,
  );
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { "application/json": { schema: { $ref: ERROR_RESPONSE_REF } } },
  };
}

export function buildOpenApiDocument(
  routes: readonly DiscoveredRoute[],
  bindings: RouteBindings,
  options: BuildOptions,
): Record<string, unknown> {
  assertCoverage(routes, bindings);

  const paths: Record<string, Record<string, unknown>> = {};
  const usedTags = new Set<string>();
  const usedSchemes = new Set<string>();

  for (const route of routes) {
    const binding = bindings[routeKey(route)];
    if (!binding || !options.include.includes(binding.visibility)) continue;
    const path = toOpenApiPath(route.path);
    paths[path] ??= {};
    const publicOnly =
      options.include.length === 1 && options.include[0] === "public";
    const operation = operationFor(binding, route.path, publicOnly);
    paths[path][route.method.toLowerCase()] = operation;
    for (const tag of binding.tags) usedTags.add(tag);
    for (const entry of operation.security as Record<string, unknown>[])
      for (const scheme of Object.keys(entry)) usedSchemes.add(scheme);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: options.title,
      version: options.version,
      description: options.description,
    },
    servers: [
      {
        url: options.serverUrl,
        // A templated host, not a literal: the base url differs per environment and there is no
        // production one yet. The predecessor shipped a dead CloudFront host; a hard-coded
        // localhost would have been worse, since it looks plausible in a published SDK.
        variables: {
          baseUrl: {
            default: "http://localhost:3000",
            description:
              "Base URL of the Fabric API for your environment. Supplied by the client; the API does not assume one.",
          },
        },
      },
    ],
    tags: [...usedTags].sort().map((name) => ({ name })),
    paths,
    components: {
      // ONLY the schemes the included operations actually use. Emitting the whole catalogue leaked
      // the internal auth surface into the customer artifact: `bffInternal` and `webhookToken` are
      // referenced by no public route, yet the published file named their headers, their env vars,
      // the existence of an admin surface, and the one credential that travels in a query string.
      // Paths honoured `visibility` and components did not, which made "visibility is a security
      // decision" true of half the document.
      securitySchemes: Object.fromEntries(
        Object.entries(SECURITY_SCHEMES).filter(([name]) =>
          usedSchemes.has(name),
        ),
      ),
      schemas: { ErrorEnvelope: errorEnvelopeSchema() },
    },
  };
}

/**
 * The F8.3 envelope, written out rather than derived: `@app/contracts` exports the PARSER for it,
 * and parsers are permissive by design (they accept what older servers emit). The doc must describe
 * what this server PRODUCES, which is narrower.
 */
function errorEnvelopeSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["type", "code", "message"],
        properties: {
          type: { type: "string" },
          code: {
            type: "string",
            description:
              "Stable, branchable identifier. Prefer this over `message`.",
          },
          message: { type: "string" },
          param: { type: "string" },
          doc_url: { type: "string" },
        },
      },
      request_id: {
        type: "string",
        description: "Quote this in a support request.",
      },
    },
  };
}

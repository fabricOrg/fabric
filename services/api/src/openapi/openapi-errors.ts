/**
 * The error half of every operation: the codes any route can return, and the envelope they carry.
 *
 * Split out of `openapi-document.ts` when that file crossed the 300-line source guard. The guard's
 * point is that the pressure produces this: assembly logic and error vocabulary are separate
 * concerns that happened to share a file.
 */

/** Every route returns the platform error envelope, so it is documented once, not 140 times. */
export const ERROR_RESPONSE_REF = "#/components/schemas/ErrorEnvelope";

export const ALWAYS_POSSIBLE_ERRORS: Readonly<Record<string, string>> = {
  "400": "Invalid request.",
  "401": "Missing or invalid credentials.",
  "429": "Rate limited. Retry after the interval in `Retry-After`.",
  "500": "Unexpected server error.",
};

export function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { "application/json": { schema: { $ref: ERROR_RESPONSE_REF } } },
  };
}

/**
 * The F8.3 envelope, written out rather than derived: `@app/contracts` exports the PARSER for it,
 * and parsers are permissive by design (they accept what older servers emit). The document must
 * describe what this server PRODUCES, which is narrower.
 */
export function errorEnvelopeSchema(): Record<string, unknown> {
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

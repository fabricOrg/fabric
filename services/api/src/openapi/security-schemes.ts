/**
 * The credentials this API accepts, one entry per `SecurityScheme`. Written here rather than inline
 * so that adding a scheme is a deliberate act with a description a reader can audit — "which key
 * opens the admin surface" should be answerable from the spec alone.
 */
export const SECURITY_SCHEMES: Readonly<Record<string, unknown>> = {
  secretKey: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "sk_test_… or sk_live_…",
    description:
      "Customer API key. Server-to-server only — these must never reach a browser. The prefix " +
      "encodes the environment, and scopes are per-key.",
  },
  bffInternal: {
    type: "apiKey",
    in: "header",
    name: "x-internal-token",
    description:
      "Shared secret between the Next.js BFFs and this API (`BFF_INTERNAL_TOKEN`). A browser " +
      "never holds this: the route handler runs server-side and supplies the tenant from the " +
      "authenticated session, never from the client.",
  },
  operatorToken: {
    type: "apiKey",
    in: "header",
    name: "x-operator-token",
    description:
      "Staff/control-plane secret (`OPERATOR_TOKEN`). Opens the admin surface and this " +
      "documentation endpoint.",
  },
  tenantToken: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "short-lived minted tenant token",
    description:
      "Minted per request by a BFF for data-plane calls (ADR-0003). Short-lived and scoped to one " +
      "tenant; not issuable by customers.",
  },
  webhookToken: {
    type: "apiKey",
    in: "header",
    name: "x-webhook-token",
    description:
      "Provider ingress secret (`WEBHOOK_INGRESS_TOKEN`). Also accepted as `?token=` because " +
      "carriers such as Arkesel issue header-less GET callbacks. Authenticates the CALLER as our " +
      "configured provider; it is not a signature over the payload.",
  },
};

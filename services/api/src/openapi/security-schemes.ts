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
    name: "x-bff-token",
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

/**
 * Schemes that describe STAFF or SERVICE credentials, never a customer one.
 *
 * They are stripped from operations in the public artifact even where the guard genuinely accepts
 * them. `OperatorOrTenantGuard` really does take an operator token on ten `/v1` routes, so listing
 * it is *accurate* — but accuracy to the wrong audience is the problem: the customer-facing document
 * would tell an SDK user that `POST /v1/api-keys`, a credential-minting route, also accepts a staff
 * token granting cross-tenant access, and name the header to send it in.
 *
 * The operator path is real and stays documented — in the internal artifact, for the people who
 * have that credential. Stripping never empties an operation's security, and the builder now
 * genuinely enforces that: a `public` route declaring only staff credentials fails generation
 * rather than silently re-publishing the scheme.
 */
export const INTERNAL_ONLY_SCHEMES: ReadonlySet<string> = new Set([
  "bffInternal",
  "operatorToken",
  "webhookToken",
  // `tenantToken` is minted BY a BFF, for itself. Its own description says it is "not issuable by
  // customers" — so listing it in the customer artifact as an accepted alternative on every public
  // operation told SDK readers about a credential they can never hold. No public operation accepts
  // it alone, so stripping it never empties an operation's security.
  "tenantToken",
]);

import type { SmsVariantContent, VariableSchema } from "@app/contracts";
import { VERIFY_RESERVED_VARIABLES } from "@app/contracts";
import {
  type EnvironmentId,
  messageDefinitionReleases,
  messageDefinitions,
  messageDefinitionVersions,
  type TenantDrizzleTx,
  type TenantId,
} from "@app/db";
import { extractTokens, previewSms } from "@app/domain";
import { and, eq, sql } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";

/** The token every verify template must carry, or the OTP is not in the message it is sent in. */
const CODE_TOKEN = "code";

/**
 * What Fabric injects, with the types it actually injects.
 *
 * The types matter more than they look. `validatePayload` checks every property PRESENT in the data
 * against its declaration, whether or not the template references it — so declaring these as
 * strings while passing numbers made every templated request fail `expected_string` on
 * `expires_minutes`, including templates that never mention it.
 */
export interface VerifyReservedValues {
  readonly code: string;
  readonly expires_minutes: number;
  readonly expires_seconds: number;
}

// Keyed by the CONTRACT's tuple, so a name added there without a type here is a COMPILE error.
// As a loose Record it was `... | undefined` under noUncheckedIndexedAccess, assigned into an
// unknown-valued map — drift compiled and failed silently at runtime instead.
const RESERVED_NODES: Record<
  (typeof VERIFY_RESERVED_VARIABLES)[number],
  { type: "string" | "integer" }
> = {
  code: { type: "string" },
  expires_minutes: { type: "integer" },
  expires_seconds: { type: "integer" },
};

export interface VerifyTemplateInput {
  readonly key: string;
  readonly locale?: string | undefined;
  readonly variables?: Record<string, string | number | boolean> | undefined;
  /** Injected by Fabric, never by the caller (ADR-0017 §1a). */
  readonly reserved: VerifyReservedValues;
}

/**
 * Render a released SMS definition into an OTP body (ADR-0017).
 *
 * Eligibility is checked HERE as well as at authoring time, and deliberately so: the caller names
 * the key per request, so an unknown or ineligible key is a caller error at integration time, and a
 * 400 naming the reason is a better outcome than a send whose wording silently fell back to
 * something the caller did not choose.
 *
 * Two invariants, both refusals rather than repairs:
 *
 *  - the rendered variant must contain `{{code}}`. A definition without it produces a perfectly
 *    valid SMS containing no verification code — the send succeeds, the wallet is charged, and the
 *    user waits for something that was never in the message. Silent, total, and indistinguishable
 *    from a carrier problem.
 *  - the class must be `transactional`. Promotional traffic is filtered by carriers and billed as a
 *    different class, so a quietly-promotional OTP is both a deliverability and a billing defect.
 */
export async function renderVerifyTemplate(
  tx: TenantDrizzleTx,
  tenantId: string,
  environmentId: string,
  input: VerifyTemplateInput,
): Promise<string> {
  const [released] = await tx
    .select({
      channel: messageDefinitionVersions.channel,
      content: messageDefinitionVersions.content,
      schema: messageDefinitionVersions.variableSchema,
      defaultLocale: messageDefinitionVersions.defaultLocale,
    })
    .from(messageDefinitionReleases)
    .innerJoin(
      messageDefinitions,
      eq(messageDefinitions.id, messageDefinitionReleases.definitionId),
    )
    .innerJoin(
      messageDefinitionVersions,
      eq(messageDefinitionVersions.id, messageDefinitionReleases.versionId),
    )
    .where(
      and(
        eq(messageDefinitionReleases.tenantId, tenantId as TenantId),
        eq(
          messageDefinitionReleases.environmentId,
          environmentId as EnvironmentId,
        ),
        sql`lower(${messageDefinitions.key}) = lower(${input.key})`,
      ),
    )
    .limit(1);

  if (!released) {
    throw notFound(
      "verify_template_not_released",
      "No released message definition with that key in this environment.",
    );
  }
  if (released.channel !== "sms") {
    throw invalidRequest(
      "verify_template_not_sms",
      "A verification template must be an SMS definition.",
      "template",
    );
  }

  return renderOtpBody({
    content: released.content as SmsVariantContent,
    schema: released.schema as VariableSchema,
    defaultLocale: released.defaultLocale,
    requestedLocale: input.locale,
    variables: input.variables,
    reserved: input.reserved,
  });
}

/**
 * The rendering rules, with no database in them — which is the only reason they can be tested at
 * all. The blocker that shipped here (reserved values typed as strings while numbers were passed,
 * failing every templated request) survived precisely because the logic was reachable only through
 * a query.
 */
export function renderOtpBody(input: {
  content: SmsVariantContent;
  schema: VariableSchema;
  defaultLocale: string;
  requestedLocale?: string | undefined;
  variables?: Record<string, string | number | boolean> | undefined;
  reserved: VerifyReservedValues;
}): string {
  const { content, requestedLocale, defaultLocale } = input;

  // Locale resolution matches message-preview.service.ts deliberately: a caller who ASKED for a
  // locale we do not have is told so, rather than silently receiving another language. Falling back
  // would make preview and send disagree on the same definition — preview answers
  // `locale_not_supported` — and the only signal of the mismatch would be the SMS itself, in a
  // language the recipient may not read.
  let body: string;
  if (requestedLocale === undefined || requestedLocale === defaultLocale) {
    body = content.body;
  } else {
    const variant = content.locales?.[requestedLocale]?.body;
    if (!variant) {
      throw invalidRequest(
        "locale_not_supported",
        `This template has no ${requestedLocale} variant.`,
        "locale",
      );
    }
    body = variant;
  }

  if ((content.class ?? "transactional") !== "transactional") {
    throw invalidRequest(
      "verify_template_not_transactional",
      "A verification template must be transactional; promotional traffic is filtered by carriers.",
      "template",
    );
  }
  if (!extractTokens(body).includes(CODE_TOKEN)) {
    throw invalidRequest(
      "verify_template_missing_code",
      "A verification template must contain {{code}}, or the message carries no verification code.",
      "template",
    );
  }

  // Reserved values are applied LAST so they cannot be shadowed. The contract already refuses a
  // caller-supplied reserved name, so this is the second of two locks on the same door.
  const data: Record<string, unknown> = {
    ...(input.variables ?? {}),
    ...input.reserved,
  };
  const outcome = previewSms({
    template: body,
    schema: withReservedDeclared(input.schema),
    data,
    currency: "GHS",
  });
  if (!outcome.preview) {
    const first = outcome.blockers[0];
    throw invalidRequest(
      "verify_template_unrenderable",
      `The verification template could not be rendered: ${first?.code ?? "unknown"} at ${first?.path || "(body)"}.`,
      "variables",
    );
  }
  return outcome.preview.body;
}

/**
 * Declare the reserved variables so the renderer's "every token must be declared" rule accepts them.
 *
 * An author does not — and should not have to — declare `code` in their own variable schema: it is
 * ours, not theirs. Without this, every otherwise-valid verify template would fail with
 * `unknown_token` on the one token it is required to contain.
 */
function withReservedDeclared(schema: VariableSchema): VariableSchema {
  const properties: Record<string, unknown> = {
    ...(schema.type === "object" ? schema.properties : {}),
  };
  for (const name of VERIFY_RESERVED_VARIABLES) {
    properties[name] = RESERVED_NODES[name];
  }
  // Spread the original FIRST so `required`, `additionalProperties` and anything else the author
  // declared survive; only `properties` is replaced. Dropping `required` meant a definition whose
  // author marked `merchant` mandatory rendered "Your  verification code is …" — an empty brand,
  // billed and delivered — instead of refusing the request.
  return { ...schema, type: "object", properties } as VariableSchema;
}

/**
 * The OTP body: a caller-chosen template, or the built-in wording.
 *
 * Lives here rather than in the service so the service stays a thin orchestration of
 * throttle → persist → send, and so the template rules sit next to the renderer that enforces them.
 *
 * A template needs an environment to resolve a release in. The BFF tenant-token path carries none
 * (ADR-0003), so `template` is refused there rather than guessed at — picking an environment on the
 * caller's behalf would render whichever one happened to be found first.
 */
export async function resolveVerifyBody(input: {
  db: {
    withTenantDrizzle: <T>(
      tenantId: string,
      fn: (tx: TenantDrizzleTx) => Promise<T>,
    ) => Promise<T>;
  };
  tenantId: string;
  environmentId: string | null;
  request: {
    template?: string | undefined;
    locale?: string | undefined;
    variables?: Record<string, string | number | boolean> | undefined;
  };
  reserved: { code: string; expires_minutes: number; expires_seconds: number };
}): Promise<string> {
  const { request, reserved } = input;
  if (!request.template) {
    // The built-in wording INTERPOLATES the derived lifetime rather than restating it. The literal
    // "5 minutes" beside a 300-second constant was a message that would start lying the moment the
    // TTL changed.
    return `Your Fabric verification code is ${reserved.code}. It expires in ${reserved.expires_minutes} minutes.`;
  }
  if (!input.environmentId) {
    throw invalidRequest(
      "verify_template_requires_key",
      "Templated verifications require an application-scoped API key, which names the environment the template is released in.",
      "template",
    );
  }
  const environmentId = input.environmentId;
  return input.db.withTenantDrizzle(input.tenantId, (tx) =>
    renderVerifyTemplate(tx, input.tenantId, environmentId, {
      key: request.template as string,
      locale: request.locale,
      variables: request.variables,
      reserved,
    }),
  );
}

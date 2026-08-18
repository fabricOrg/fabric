import postgres from "postgres";

/**
 * Self-configuration for the contract probe.
 *
 * The probe used to need five environment variables and a hand-built JSON map of path-parameter
 * values. That is a recipe nobody reproduces, which makes "prove the endpoint works" (CLAUDE.md
 * §12) something only whoever wrote the recipe can do. Everything here is discoverable: the ids come
 * from the database, the tenant token is minted through the API's own endpoint, and the API key is
 * created and revoked around the run.
 */

export interface ProbeContext {
  readonly tenantToken: string;
  readonly apiKey: string;
  readonly ids: Record<string, string>;
  /** Revokes the key this run created. Always call it, including on failure. */
  readonly cleanup: () => Promise<void>;
}

const SCOPES = [
  "sms:send",
  "sms:read",
  "email:send",
  "email:read",
  "whatsapp:send",
  "wallet:read",
  "request_logs:read",
  "api_keys:read",
  "definitions:read",
  "messages:send",
  "messages:read",
];

async function post(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `${path} -> ${response.status} ${JSON.stringify(payload).slice(0, 200)}`,
    );
  }
  // The API envelopes every JSON success; this helper is a client like any other.
  return (payload.data as Record<string, unknown>) ?? payload;
}

export async function discover(
  baseUrl: string,
  bffToken: string,
): Promise<ProbeContext> {
  const url = process.env.DATABASE_URL_SUPER ?? process.env.DATABASE_URL_APP;
  if (!url) {
    throw new Error(
      "contracts:probe needs DATABASE_URL_SUPER or DATABASE_URL_APP to discover ids. " +
        "Add it to .env, or set PROBE_IDS yourself to skip discovery.",
    );
  }
  const sql = postgres(url, { max: 1 });
  // Declared OUTSIDE the try so the failure path can still revoke. The first version created the
  // key, threw later during id discovery, and left an ACTIVE credential behind — a diagnostic that
  // leaks a key when it fails is worse than one that does not run.
  let createdKeyId = "";
  let mintedToken = "";
  const revokeKey = async () => {
    if (!createdKeyId || !mintedToken) return;
    await fetch(`${baseUrl}/v1/api-keys/${createdKeyId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${mintedToken}` },
    }).catch(() => undefined);
  };
  try {
    /**
     * Best-effort lookup. A table that does not exist in this database yields "" and the route that
     * needed it is reported SKIPPED — one absent fixture must not abort the whole probe, which is
     * what a raw throw here did the first time it hit a renamed table.
     */
    const one = async (
      query: string,
      params: readonly string[] = [],
    ): Promise<string> => {
      try {
        const rows = await sql.unsafe<{ id: string }[]>(query, [...params]);
        return rows[0]?.id ?? "";
      } catch {
        return "";
      }
    };
    const tenantId = await one(
      "select id from accounts order by created_at limit 1",
    );
    if (!tenantId)
      throw new Error("no tenant in this database — run pnpm dev:seed");
    // Parameterised, not interpolated. `tenantId` comes from our own `accounts` table so this was
    // never exploitable — but an interpolated-uuid query is a pattern that gets copied to a place
    // where the value is user-supplied, and the binding is right there.
    const applicationId = await one(
      "select id from applications where tenant_id = $1 limit 1",
      [tenantId],
    );
    const environmentId = await one(
      "select id from environments where tenant_id = $1 and type = 'sandbox' limit 1",
      [tenantId],
    );

    const minted = await post(
      baseUrl,
      "/internal/identity/tenant-token",
      { tenant_id: tenantId },
      { "x-bff-token": bffToken },
    );
    const tenantToken = String(minted.token ?? "");
    if (!tenantToken) throw new Error("could not mint a tenant token");
    mintedToken = tenantToken;

    const created = await post(
      baseUrl,
      "/v1/api-keys",
      {
        name: "contracts:probe (temporary)",
        env: "sandbox",
        scopes: SCOPES,
        ...(applicationId ? { application_id: applicationId } : {}),
      },
      { authorization: `Bearer ${tenantToken}` },
    );
    const apiKey = String(created.secret ?? "");
    createdKeyId = String((created.key as { id?: string })?.id ?? "");

    const ids: Record<string, string> = {
      tenantId,
      accountId: tenantId,
      id: tenantId,
      applicationId,
      environmentId,
      provider: "arkesel-sms",
      key: "platform.payments",
      msisdn: "+233000000000",
      staffId: await one("select id from staff_users limit 1"),
      userId: await one("select id from users limit 1"),
      versionId: await one("select id from pricing_offer_versions limit 1"),
      offerId: await one("select id from pricing_offers limit 1"),
      messageId: await one(
        "select id from messages order by created_at desc limit 1",
      ),
      emailId: await one(
        "select id from email_messages order by created_at desc limit 1",
      ),
      batchId: await one(
        "select id from message_batches order by created_at desc limit 1",
      ),
      whatsappId: await one(
        "select id from whatsapp_messages order by created_at desc limit 1",
      ),
      webhookId: await one("select id from webhook_endpoints limit 1"),
      deliveryId: await one("select id from message_deliveries limit 1"),
    };

    return {
      tenantToken,
      apiKey,
      ids,
      cleanup: async () => {
        // The probe mints a real credential. Leaving it behind would be a live key created by a
        // diagnostic, which is exactly the kind of thing nobody remembers to clean up later.
        await revokeKey();
        await sql.end({ timeout: 5 });
      },
    };
  } catch (error) {
    await revokeKey();
    await sql.end({ timeout: 5 });
    throw error;
  }
}

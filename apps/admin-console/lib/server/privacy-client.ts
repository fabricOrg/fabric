import "server-only";

import {
  type ErasureResult,
  erasureResultSchema,
  type SubjectSummary,
  subjectSummarySchema,
} from "@app/contracts";
import { API_EXTERNAL_WRITE_TIMEOUT_MS, apiFetch } from "./api-fetch";
import { unwrapEnvelope } from "./response-envelope";

/**
 * DSR (data-subject rights) calls into the api. Server-only: the BFF token never reaches a browser,
 * and the acting staff member is supplied from the authenticated session — never from the client.
 */
function config() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

export class PrivacyApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super("Privacy API request failed.");
  }
}

async function parse(response: Response): Promise<unknown> {
  const payload = unwrapEnvelope(await response.json().catch(() => null));
  if (!response.ok) throw new PrivacyApiError(response.status, payload);
  return payload;
}

/** What personal data does this workspace hold on this number? Kinds only — never the values. */
export async function lookupSubject(
  tenantId: string,
  msisdn: string,
): Promise<SubjectSummary> {
  const { baseUrl, bffToken } = config();
  const url = new URL(
    `/internal/admin/privacy/tenants/${tenantId}/subject`,
    baseUrl,
  );
  url.searchParams.set("msisdn", msisdn);
  const response = await apiFetch(url, {
    cache: "no-store",
    headers: { "x-bff-token": bffToken },
  });
  return subjectSummarySchema.parse(await parse(response));
}

/** IRREVERSIBLE. Destroys the subject's key; no backup brings the data back. */
export async function eraseSubject(
  tenantId: string,
  body: { msisdn: string; basis: string },
  actorEmail: string,
): Promise<ErasureResult> {
  const { baseUrl, bffToken } = config();
  // Crypto-shredding walks every table that holds the subject. It is irreversible and cannot be
  // confirmed after the fact, so it gets the long budget rather than a deadline that reports a
  // failure for an erasure that actually happened.
  const response = await apiFetch(
    new URL(`/internal/admin/privacy/tenants/${tenantId}/erasures`, baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
        "x-actor-email": actorEmail,
      },
      body: JSON.stringify(body),
    },
    API_EXTERNAL_WRITE_TIMEOUT_MS,
  );
  return erasureResultSchema.parse(await parse(response));
}

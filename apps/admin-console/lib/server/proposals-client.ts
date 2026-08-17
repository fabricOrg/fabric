import "server-only";

import {
  type CreateProposalRequest,
  type DecideProposalRequest,
  type ListProposalsResponse,
  listProposalsResponseSchema,
  type ProposalDto,
  proposalDtoSchema,
} from "@app/contracts";
import { unwrapEnvelope } from "./response-envelope";

/** Maker-checker control plane via the api's BffToken-guarded /internal/admin/proposals. */
export class ProposalApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Proposal API request failed with status ${status}.`);
  }
}

function config() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

function actorHeaders(actor: { email: string; staffId: string }) {
  return {
    "content-type": "application/json",
    "x-actor-email": actor.email,
    "x-actor-staff-id": actor.staffId,
  };
}

export async function listProposals(): Promise<ListProposalsResponse> {
  const { baseUrl, bffToken } = config();
  const response = await fetch(new URL("/internal/admin/proposals", baseUrl), {
    cache: "no-store",
    headers: { "x-bff-token": bffToken },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new ProposalApiError(response.status, payload);
  return listProposalsResponseSchema.parse(unwrapEnvelope(payload));
}

export async function createProposal(
  request: CreateProposalRequest,
  actor: { email: string; staffId: string },
): Promise<ProposalDto> {
  const { baseUrl, bffToken } = config();
  const response = await fetch(new URL("/internal/admin/proposals", baseUrl), {
    method: "POST",
    cache: "no-store",
    headers: { "x-bff-token": bffToken, ...actorHeaders(actor) },
    body: JSON.stringify(request),
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new ProposalApiError(response.status, payload);
  return proposalDtoSchema.parse(unwrapEnvelope(payload));
}

export async function decideProposal(
  id: string,
  request: DecideProposalRequest,
  actor: { email: string; staffId: string },
): Promise<ProposalDto> {
  const { baseUrl, bffToken } = config();
  const response = await fetch(
    new URL(`/internal/admin/proposals/${id}/decide`, baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: { "x-bff-token": bffToken, ...actorHeaders(actor) },
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new ProposalApiError(response.status, payload);
  return proposalDtoSchema.parse(unwrapEnvelope(payload));
}

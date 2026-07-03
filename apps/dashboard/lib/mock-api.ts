// Mock data layer — stands in for the per-app BFF until it lands. Same async shape the real client
// will have (Promise<DTO>, rejects with an F8.3 envelope), so screens wire once. Each call takes a
// `scenario` so any screen can demo the four global states: loading (latency) · empty · error · populated.
//
// Swap target: replace these bodies with fetch() to the BFF; signatures + return types stay identical.

import type {
  LedgerEntry,
  MessageDetail,
  MessageSummary,
  SendSmsRequest,
  SendSmsResponse,
  WalletBalance,
} from "@app/contracts";
import {
  LEDGER,
  MESSAGE_DETAILS,
  MESSAGES,
  SAMPLE_ERROR,
  WALLET_BALANCES,
} from "./fixtures.js";

export type Scenario = "populated" | "empty" | "error";
export type SendScenario = "ok" | "insufficient" | "error";

const LATENCY_MS = 600;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function fail(envelope: unknown): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(envelope), LATENCY_MS),
  );
}

const INSUFFICIENT_FUNDS = {
  error: {
    type: "insufficient_funds_error",
    code: "insufficient_funds",
    message: "Not enough balance to send. Top up your wallet to continue.",
  },
  request_id: "req_402ba17c",
} as const;

const NOT_FOUND = {
  error: {
    type: "not_found_error",
    code: "resource_missing",
    message: "No such message.",
  },
  request_id: "req_404ee900",
} as const;

export function listMessages(
  scenario: Scenario = "populated",
): Promise<readonly MessageSummary[]> {
  if (scenario === "error") return fail(SAMPLE_ERROR);
  return delay(scenario === "empty" ? [] : MESSAGES);
}

export function getMessage(
  id: string,
  scenario: Scenario = "populated",
): Promise<MessageDetail> {
  if (scenario === "error") return fail(SAMPLE_ERROR);
  const found = MESSAGE_DETAILS[id];
  if (!found) return fail(NOT_FOUND);
  return delay(found);
}

export function getWallet(
  scenario: Scenario = "populated",
): Promise<readonly WalletBalance[]> {
  if (scenario === "error") return fail(SAMPLE_ERROR);
  return delay(scenario === "empty" ? [] : WALLET_BALANCES);
}

export function listLedger(
  scenario: Scenario = "populated",
): Promise<readonly LedgerEntry[]> {
  if (scenario === "error") return fail(SAMPLE_ERROR);
  return delay(scenario === "empty" ? [] : LEDGER);
}

/** Mock send. `insufficient` rejects with the 402 envelope so L-D1 can wire the block→/wallet path. */
export function sendSms(
  req: SendSmsRequest,
  scenario: SendScenario = "ok",
): Promise<SendSmsResponse> {
  if (scenario === "error") return fail(SAMPLE_ERROR);
  if (scenario === "insufficient") return fail(INSUFFICIENT_FUNDS);
  return delay({
    id: "msg_new01",
    status: "accepted",
    encoding: req.body.length > 160 ? "ucs2" : "gsm7",
    segments: 1,
    cost: { currency: "GHS", minor: "3" },
  });
}

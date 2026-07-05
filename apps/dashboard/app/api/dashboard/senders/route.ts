// TODO(BFF): replace mock with dashboardApi("/v1/senders", "senders:read"/"senders:write")
//
// Mock-first stub for Sender-ID management. GET returns a realistic fixture; POST echoes back the
// created sender as `pending` (carrier/NCC review). No real backend is called — the /v1/senders
// route does not exist yet. Error shape mirrors app/api/dashboard/wallet/route.ts.

import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

type SenderStatus = "active" | "pending" | "rejected";
type SenderCountry = "NG" | "GH";
type SenderType = "alphanumeric" | "short-code";

interface SenderId {
  id: string;
  senderId: string;
  status: SenderStatus;
  country: SenderCountry;
  type: SenderType;
  useCase: string;
  submittedAt: string;
  note?: string;
}

const ALPHANUMERIC_MAX_LEN = 11;

const MOCK_SENDERS: readonly SenderId[] = [
  {
    id: "snd_01hf3a",
    senderId: "Fabric",
    status: "active",
    country: "NG",
    type: "alphanumeric",
    useCase: "Transactional OTPs and delivery notifications.",
    submittedAt: "2026-05-12T09:24:00.000Z",
  },
  {
    id: "snd_01hf3b",
    senderId: "KwikGH",
    status: "active",
    country: "GH",
    type: "alphanumeric",
    useCase: "Order confirmations and dispatch alerts.",
    submittedAt: "2026-05-20T14:02:00.000Z",
  },
  {
    id: "snd_01hf3c",
    senderId: "FabricPay",
    status: "pending",
    country: "NG",
    type: "alphanumeric",
    useCase: "Payment receipts and two-factor authentication codes.",
    submittedAt: "2026-06-28T11:47:00.000Z",
  },
  {
    id: "snd_01hf3d",
    senderId: "2929",
    status: "pending",
    country: "GH",
    type: "short-code",
    useCase: "Two-way marketing keyword campaigns.",
    submittedAt: "2026-07-01T08:15:00.000Z",
  },
  {
    id: "snd_01hf3e",
    senderId: "PromoNG",
    status: "rejected",
    country: "NG",
    type: "alphanumeric",
    useCase: "Promotional broadcasts to opted-in subscribers.",
    submittedAt: "2026-06-10T16:33:00.000Z",
    note: "Name too similar to a protected brand. NCC requires a distinct sender ID; resubmit with a unique name.",
  },
  {
    id: "snd_01hf3f",
    senderId: "AlertsGH",
    status: "active",
    country: "GH",
    type: "alphanumeric",
    useCase: "Service outage and account security alerts.",
    submittedAt: "2026-04-30T07:05:00.000Z",
  },
];

export function GET() {
  return NextResponse.json({ senders: MOCK_SENDERS });
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(
      {
        error: {
          type: "auth_error",
          code: "invalid_origin",
          message: "Request rejected.",
        },
      },
      { status: 403 },
    );
  }

  try {
    const input = (await request.json()) as {
      senderId?: unknown;
      country?: unknown;
      type?: unknown;
      useCase?: unknown;
    };

    const senderId =
      typeof input.senderId === "string" ? input.senderId.trim() : "";
    const country =
      input.country === "NG" || input.country === "GH" ? input.country : null;
    const type =
      input.type === "alphanumeric" || input.type === "short-code"
        ? input.type
        : null;
    const useCase =
      typeof input.useCase === "string" ? input.useCase.trim() : "";

    if (!senderId || !country || !type || !useCase) {
      return validationError("All fields are required.");
    }
    if (type === "alphanumeric" && !/^[A-Za-z0-9]{1,11}$/.test(senderId)) {
      return validationError(
        `Alphanumeric sender IDs must be 1–${ALPHANUMERIC_MAX_LEN} letters or digits.`,
      );
    }
    if (type === "short-code" && !/^\d{3,8}$/.test(senderId)) {
      return validationError("Short codes must be 3–8 digits.");
    }

    const created: SenderId = {
      id: `snd_${Math.random().toString(36).slice(2, 10)}`,
      senderId,
      status: "pending",
      country,
      type,
      useCase,
      submittedAt: new Date().toISOString(),
    };
    return NextResponse.json({ sender: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function validationError(message: string) {
  return NextResponse.json(
    { error: { type: "validation_error", code: "invalid_request", message } },
    { status: 422 },
  );
}

function errorResponse(error: unknown) {
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : NextResponse.json(
        {
          error: {
            type: "api_error",
            code: "bff_error",
            message: "Request failed.",
          },
        },
        { status: 500 },
      );
}

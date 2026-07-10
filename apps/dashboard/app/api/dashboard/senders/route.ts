// Senders BFF — REAL (E10): GET lists the tenant's registrations, POST submits one for review.
// The api enforces active registrations on the live send path (sender_not_registered), so what
// this screen shows is exactly what can send. Shapes map @app/contracts snake_case → the UI's
// camelCase SenderId.

import type { ListSendersResponse, SenderDto } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

interface SenderId {
  id: string;
  senderId: string;
  status: SenderDto["status"];
  country: SenderDto["country"];
  type: SenderDto["type"];
  useCase: string;
  submittedAt: string;
  note?: string;
}

function toUi(dto: SenderDto): SenderId {
  return {
    id: dto.id,
    senderId: dto.sender_id,
    status: dto.status,
    country: dto.country,
    type: dto.type,
    useCase: dto.use_case,
    submittedAt: dto.created_at,
    ...(dto.rejection_reason ? { note: dto.rejection_reason } : {}),
  };
}

export async function GET() {
  try {
    const response = await dashboardApi<ListSendersResponse>(
      "/v1/senders",
      "sms:read",
    );
    return NextResponse.json({ senders: response.senders.map(toUi) });
  } catch (error) {
    return errorResponse(error);
  }
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
    const created = await dashboardApi<SenderDto>("/v1/senders", "sms:send", {
      method: "POST",
      body: JSON.stringify({
        sender_id: typeof input.senderId === "string" ? input.senderId : "",
        country: input.country,
        type: input.type ?? "alphanumeric",
        use_case: typeof input.useCase === "string" ? input.useCase : "",
      }),
    });
    return NextResponse.json({ sender: toUi(created) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
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

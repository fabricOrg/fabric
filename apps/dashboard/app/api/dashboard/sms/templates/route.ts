import {
  createSmsTemplateRequest,
  type ListSmsTemplatesResponse,
  type SmsTemplate,
} from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

export async function GET() {
  try {
    return NextResponse.json(
      await dashboardApi<ListSmsTemplatesResponse>(
        "/v1/sms/templates",
        "sms:read",
      ),
    );
  } catch (error) {
    return respond(error);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return rejectedOrigin();
  const parsed = createSmsTemplateRequest.safeParse(await request.json());
  if (!parsed.success) return invalidTemplate();
  try {
    return NextResponse.json(
      await dashboardApi<SmsTemplate>("/v1/sms/templates", "sms:send", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      }),
      { status: 201 },
    );
  } catch (error) {
    return respond(error);
  }
}

function rejectedOrigin() {
  return NextResponse.json(
    { error: { code: "invalid_origin", message: "Request rejected." } },
    { status: 403 },
  );
}

function invalidTemplate() {
  return NextResponse.json(
    {
      error: {
        code: "invalid_sms_template",
        message: "The SMS template is invalid.",
      },
    },
    { status: 400 },
  );
}

function respond(error: unknown) {
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : NextResponse.json(
        { error: { code: "bff_error", message: "Request failed." } },
        { status: 500 },
      );
}

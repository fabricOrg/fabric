import {
  createSmsTemplateRequest,
  listSmsTemplatesResponse,
  smsTemplate,
} from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
} from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";

export async function GET() {
  try {
    return NextResponse.json(
      listSmsTemplatesResponse.parse(
        await dashboardApi("/v1/sms/templates", "sms:read"),
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
      smsTemplate.parse(
        await dashboardApi("/v1/sms/templates", "sms:send", {
          method: "POST",
          body: JSON.stringify(parsed.data),
        }),
      ),
      { status: 201 },
    );
  } catch (error) {
    return respond(error);
  }
}

function rejectedOrigin() {
  return bffForbidden("invalid_origin", "Request rejected.");
}

function invalidTemplate() {
  return bffInvalidRequest(
    "invalid_sms_template",
    "The SMS template is invalid.",
  );
}

function respond(error: unknown) {
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("bff_error", "Request failed.");
}

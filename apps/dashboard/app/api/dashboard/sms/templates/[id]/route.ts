import { smsTemplate, updateSmsTemplateRequest } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
} from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!hasTrustedOrigin(request)) return rejectedOrigin();
  const parsed = updateSmsTemplateRequest.safeParse(await request.json());
  if (!parsed.success) return invalidTemplate();
  const { id } = await context.params;
  try {
    return NextResponse.json(
      smsTemplate.parse(
        await dashboardApi(
          `/v1/sms/templates/${encodeURIComponent(id)}`,
          "sms:send",
          { method: "PATCH", body: JSON.stringify(parsed.data) },
        ),
      ),
    );
  } catch (error) {
    return respond(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!hasTrustedOrigin(request)) return rejectedOrigin();
  const { id } = await context.params;
  try {
    await dashboardApi(
      `/v1/sms/templates/${encodeURIComponent(id)}`,
      "sms:send",
      { method: "DELETE" },
    );
    return new NextResponse(null, { status: 204 });
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

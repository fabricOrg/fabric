import { type SmsTemplate, updateSmsTemplateRequest } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
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
      await dashboardApi<SmsTemplate>(
        `/v1/sms/templates/${encodeURIComponent(id)}`,
        "sms:send",
        { method: "PATCH", body: JSON.stringify(parsed.data) },
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

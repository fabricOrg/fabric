import { createMessageDefinitionRequest } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  createMessageDefinition,
  listMessageDefinitions,
} from "@/lib/server/message-definitions-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** List managed message definitions for the workspace. Any authenticated member. */
export async function GET(request: Request) {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return authError("invalid_session", "Sign in again to continue.", 401);
  }
  try {
    const applicationId = new URL(request.url).searchParams.get(
      "applicationId",
    );
    if (!applicationId) {
      return authError(
        "application_required",
        "Choose an application before listing definitions.",
        422,
      );
    }
    if (!(await ownsApplication(applicationId))) {
      return authError(
        "application_not_accessible",
        "The selected application is not available.",
        403,
      );
    }
    return NextResponse.json(await listMessageDefinitions(applicationId));
  } catch (error) {
    return fromBffError(error);
  }
}

/** Create a draft definition. Owner/admin only (authoring/publishing is not the developer lane). */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return authError("invalid_origin", "Request rejected.", 403);
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return authError("invalid_session", "Sign in again to continue.", 401);
  }
  if (!session.permissions.includes("definitions:write")) {
    return authError(
      "insufficient_permission",
      "You do not have permission to author message definitions.",
      403,
    );
  }
  try {
    const parsed = createMessageDefinitionRequest.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            type: "validation_error",
            code: "invalid_request",
            message: parsed.error.issues[0]?.message ?? "Invalid definition.",
          },
        },
        { status: 422 },
      );
    }
    if (!parsed.data.application_id) {
      return authError(
        "application_required",
        "Choose the application that owns this definition.",
        422,
      );
    }
    if (!(await ownsApplication(parsed.data.application_id))) {
      return authError(
        "application_not_accessible",
        "The selected application is not available.",
        403,
      );
    }
    return NextResponse.json(await createMessageDefinition(parsed.data), {
      status: 201,
    });
  } catch (error) {
    return fromBffError(error);
  }
}

async function ownsApplication(applicationId: string): Promise<boolean> {
  const { applications } = await listApplications();
  return applications.some((application) => application.id === applicationId);
}

function authError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { type: "auth_error", code, message } },
    { status },
  );
}

function fromBffError(error: unknown) {
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

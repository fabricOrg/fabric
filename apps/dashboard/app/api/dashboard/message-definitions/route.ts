import { createMessageDefinitionRequest } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
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
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  try {
    const applicationId = new URL(request.url).searchParams.get(
      "applicationId",
    );
    if (!applicationId) {
      return bffUnprocessable(
        "application_required",
        "Choose an application before listing definitions.",
      );
    }
    if (!(await ownsApplication(applicationId))) {
      return bffForbidden(
        "application_not_accessible",
        "The selected application is not available.",
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
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  if (!session.permissions.includes("definitions:write")) {
    return bffForbidden(
      "insufficient_permission",
      "You do not have permission to author message definitions.",
    );
  }
  try {
    const parsed = createMessageDefinitionRequest.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return bffUnprocessable(
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid definition.",
      );
    }
    if (!parsed.data.application_id) {
      return bffUnprocessable(
        "application_required",
        "Choose the application that owns this definition.",
      );
    }
    if (!(await ownsApplication(parsed.data.application_id))) {
      return bffForbidden(
        "application_not_accessible",
        "The selected application is not available.",
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

function fromBffError(error: unknown) {
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("bff_error", "Request failed.");
}

import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { listWhatsappTemplates } from "@/lib/server/whatsapp-client";

/**
 * The APPROVED WhatsApp template catalog for the compose picker.
 *
 * Gated on `whatsapp:send` rather than `whatsapp:read`: this list exists to compose a message, and the
 * template body it returns is content the workspace is about to send. Read access to the message log
 * is a different question from being allowed to see what can be sent.
 */
export async function GET() {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return NextResponse.json(
      { error: { code: "invalid_session", message: "Sign in again." } },
      { status: 401 },
    );
  }
  if (!session.permissions.includes("whatsapp:send")) {
    return NextResponse.json(
      {
        error: {
          code: "insufficient_permission",
          message: "You don't have access to send WhatsApp messages.",
        },
      },
      { status: 403 },
    );
  }
  try {
    return NextResponse.json(await listWhatsappTemplates(session.orgId));
  } catch (error) {
    // Forward the API's own error envelope untouched, like the sibling WhatsApp route. Re-wrapping it
    // would flatten a structured `code` the picker branches on into a generic message.
    if (error instanceof BffError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    return NextResponse.json(
      {
        error: {
          code: "whatsapp_templates_unavailable",
          message: "WhatsApp templates could not be loaded.",
        },
      },
      { status: 502 },
    );
  }
}

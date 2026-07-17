import type { PreviewMessageResponse } from "@app/contracts";
import { previewMessageRequest } from "@app/contracts";
import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { invalidRequest, newRequestId } from "../http/api-error.js";
import { MessagePreviewService } from "./message-preview.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/**
 * Public managed-messages surface (SDK-003 slice 5). Preview renders a RELEASED definition through the
 * same pure core a send uses — no side effects. Authenticated by an API key / BFF tenant token
 * (ApiKeyGuard); a runtime `sms:read` scope may inspect a published definition (ADR-0005 #6). The
 * environment comes from the presenting key (or the default sandbox on the BFF path), never the client.
 */
@Controller("v1/messages")
@UseGuards(ApiKeyGuard)
export class MessagesController {
  constructor(
    @Inject(MessagePreviewService)
    private readonly preview: MessagePreviewService,
  ) {}

  @Post("preview")
  async previewMessage(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<PreviewMessageResponse> {
    const tenant = requireScope(req.tenant, "sms:read");
    const parsed = previewMessageRequest.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw invalidRequest(
        "invalid_preview",
        first?.message ?? "Invalid preview request.",
        first?.path.map(String).join(".") || undefined,
      );
    }
    const out = await this.preview.preview(
      tenant.id,
      parsed.data,
      tenant.environmentId,
    );
    return {
      version_id: out.version_id,
      environment: out.environment,
      resolved_locale: out.resolved_locale,
      blockers: out.blockers.map((b) => ({ path: b.path, code: b.code })),
      warnings: out.warnings.map((warning) => ({
        path: warning.path,
        code: warning.code,
      })),
      eligible: out.eligible,
      sender: out.sender,
      message_class: out.message_class,
      preview: out.preview,
      request_id: newRequestId(),
    };
  }
}

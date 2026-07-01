import { Body, Controller, Headers, Inject, Param, Post } from "@nestjs/common";
import { newRequestId } from "../http/api-error.js";
import { SmsService } from "./sms.service.js";

/**
 * POST /webhooks/dlr/:provider — provider delivery-report ingress (F5.4). NOT ApiKeyGuard-protected:
 * the caller is the provider, authenticated by its webhook SIGNATURE (SmsService → verifyWebhook).
 * The owning tenant is resolved possession-scoped by provider_ref (no RLS bypass), then the DLR is
 * reconciled (out-of-order tolerant) + commit/refund applied inside that tenant.
 */
@Controller("webhooks/dlr")
export class DlrController {
  constructor(@Inject(SmsService) private readonly sms: SmsService) {}

  @Post(":provider")
  async ingest(
    @Param("provider") provider: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ status: string; request_id: string }> {
    const { status } = await this.sms.ingestDlr(provider, body, headers);
    return { status, request_id: newRequestId() };
  }
}

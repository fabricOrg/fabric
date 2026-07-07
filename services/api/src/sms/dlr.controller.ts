import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { newRequestId } from "../http/api-error.js";
import { SmsService } from "./sms.service.js";
import { WebhookTokenGuard } from "./webhook-token.guard.js";

/**
 * /webhooks/dlr/:provider — provider delivery-report ingress (F5.4). NOT ApiKeyGuard-protected:
 * the ingress token is checked here (header or ?token= for header-less GET callbacks), then
 * SmsService verifies the provider signature. The owning tenant is resolved possession-scoped by
 * provider_ref (no RLS bypass), then the DLR is reconciled (out-of-order tolerant) + commit/refund
 * applied inside that tenant.
 *
 * POST = JSON-body providers (e.g. the fake). GET = query-param providers (Arkesel POSTs nothing;
 * it calls the callback URL with `?sms_id=..&status=..`). Both funnel through the same ingest path;
 * the provider's parseDlr maps whatever shape it receives.
 */
@Controller("webhooks/dlr")
@UseGuards(WebhookTokenGuard)
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

  @Get(":provider")
  async ingestGet(
    @Param("provider") provider: string,
    @Query() query: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ status: string; request_id: string }> {
    const { status } = await this.sms.ingestDlr(provider, query, headers);
    return { status, request_id: newRequestId() };
  }
}

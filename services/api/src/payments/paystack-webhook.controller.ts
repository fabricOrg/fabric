import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { PaymentsService } from "./payments.service.js";

interface RawBodyRequest {
  rawBody?: Buffer;
}

/**
 * Paystack webhook. Public (no guard) — authenticity is the HMAC-SHA512 signature over the RAW body,
 * verified inside the service. Always 200 on a well-formed request so Paystack doesn't retry a
 * processed event; crediting is idempotent regardless.
 */
@Controller("webhooks/paystack")
export class PaystackWebhookController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  @Post()
  @HttpCode(200)
  async ingest(
    @Req() request: RawBodyRequest,
    @Headers("x-paystack-signature") signature: string | undefined,
  ): Promise<{ accepted: true }> {
    if (!request.rawBody) {
      throw invalidRequest("missing_raw_body", "The webhook body is required.");
    }
    await this.payments.handleWebhook(request.rawBody, signature);
    return { accepted: true };
  }
}

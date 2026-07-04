import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { invalidRequest, unauthorized } from "../http/api-error.js";
import { WorkosWebhookService } from "./workos-webhook.service.js";

interface RawBodyRequest {
  rawBody?: Buffer;
}

@Controller("webhooks/workos")
export class WorkosWebhookController {
  constructor(
    @Inject(WorkosWebhookService)
    private readonly webhooks: WorkosWebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  async ingest(
    @Req() request: RawBodyRequest,
    @Headers("workos-signature") signature: string | undefined,
  ): Promise<{ accepted: true }> {
    if (!request.rawBody) {
      throw invalidRequest(
        "missing_raw_body",
        "The WorkOS webhook body is required.",
      );
    }
    if (!signature) {
      throw unauthorized(
        "invalid_workos_signature",
        "A valid WorkOS signature is required.",
      );
    }
    await this.webhooks.ingest(request.rawBody, signature);
    return { accepted: true };
  }
}

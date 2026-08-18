import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { invalidRequest, newRequestId } from "../http/api-error.js";
import { WhatsappWebhookService } from "./whatsapp-webhook.service.js";

interface RawBodyRequest {
  rawBody?: Buffer;
}

/**
 * Public Meta Cloud webhook ingress. The subscription GET has no Meta signature, so the stored
 * verify token authenticates that hop; POST authenticity is the HMAC over Fastify's raw bytes.
 */
@Controller("webhooks/whatsapp")
export class WhatsappWebhookController {
  constructor(
    @Inject(WhatsappWebhookService)
    private readonly webhooks: WhatsappWebhookService,
  ) {}

  @Get(":provider")
  /**
   * Meta compares this body VERBATIM, so it must not be enveloped. That is enforced by the route
   * binding's `successContentType: "text/plain"`, which the response interceptor now reads — NOT by
   * an `@Header` on this handler. `@Header` applies to every response including the 403 for a wrong
   * verify token, which then tried to serialise a JSON error body as text/plain and turned it into
   * a 500. Fastify sets text/plain for a string return on its own.
   */
  async verify(
    @Param("provider") provider: string,
    @Query("hub.mode") mode: unknown,
    @Query("hub.verify_token") verifyToken: unknown,
    @Query("hub.challenge") challenge: unknown,
  ): Promise<string> {
    return this.webhooks.verifyChallenge({
      providerSlug: provider,
      mode,
      verifyToken,
      challenge,
    });
  }

  @Post(":provider")
  @HttpCode(200)
  async ingest(
    @Param("provider") provider: string,
    @Req() request: RawBodyRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ accepted: true; processed: number; request_id: string }> {
    if (!request.rawBody) {
      throw invalidRequest(
        "missing_raw_body",
        "The WhatsApp webhook body is required.",
      );
    }
    const { processed } = await this.webhooks.ingest(
      provider,
      request.rawBody,
      headers,
    );
    return { accepted: true, processed, request_id: newRequestId() };
  }
}

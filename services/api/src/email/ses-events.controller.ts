import { Body, Controller, Inject, Post } from "@nestjs/common";
import { newRequestId } from "../http/api-error.js";
import { EmailService } from "./email.service.js";

/** Public AWS SNS ingress. Authenticity is verified from the signed SNS envelope in EmailService. */
@Controller("webhooks/email/aws-ses")
export class SesEventsController {
  constructor(@Inject(EmailService) private readonly email: EmailService) {}

  @Post()
  async ingest(
    @Body() body: unknown,
  ): Promise<{ status: string; request_id: string }> {
    const result = await this.email.ingestSesEvent(body);
    return { ...result, request_id: newRequestId() };
  }
}

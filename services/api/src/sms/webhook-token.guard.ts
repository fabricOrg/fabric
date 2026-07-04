import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { unauthorized } from "../http/api-error.js";
import { readSingleHeader, secretsMatch } from "../http/shared-secret.js";

interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class WebhookTokenGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("WEBHOOK_INGRESS_TOKEN") ?? "";
    const request = context.switchToHttp().getRequest<WebhookRequest>();
    if (
      !secretsMatch(
        readSingleHeader(request.headers["x-webhook-token"]),
        expected,
      )
    ) {
      throw unauthorized(
        "invalid_webhook_token",
        "A valid webhook token is required.",
      );
    }
    return true;
  }
}

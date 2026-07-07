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
  query?: Record<string, string | string[] | undefined>;
}

@Injectable()
export class WebhookTokenGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("WEBHOOK_INGRESS_TOKEN") ?? "";
    const request = context.switchToHttp().getRequest<WebhookRequest>();
    // Prefer the header; fall back to a `?token=` query param for GET callbacks that can't set
    // headers (e.g. Arkesel DLRs). The token is a shared ingress secret (not user data), and we
    // fully control the callback URL, so carrying it in the query is safe + the standard pattern.
    const presented =
      readSingleHeader(request.headers["x-webhook-token"]) ||
      readSingleHeader(request.query?.token);
    if (!secretsMatch(presented, expected)) {
      throw unauthorized(
        "invalid_webhook_token",
        "A valid webhook token is required.",
      );
    }
    return true;
  }
}

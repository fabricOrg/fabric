import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { unauthorized } from "../http/api-error.js";
import { readSingleHeader, secretsMatch } from "../http/shared-secret.js";

interface BffRequest {
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class BffTokenGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("BFF_INTERNAL_TOKEN") ?? "";
    const request = context.switchToHttp().getRequest<BffRequest>();
    if (
      !secretsMatch(readSingleHeader(request.headers["x-bff-token"]), expected)
    ) {
      throw unauthorized(
        "invalid_bff_token",
        "A valid dashboard BFF token is required.",
      );
    }
    return true;
  }
}

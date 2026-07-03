import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { unauthorized } from "../http/api-error.js";
import { readSingleHeader, secretsMatch } from "../http/shared-secret.js";

interface OperatorRequest {
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class OperatorTokenGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("OPERATOR_TOKEN") ?? "";
    const request = context.switchToHttp().getRequest<OperatorRequest>();
    if (
      !secretsMatch(
        readSingleHeader(request.headers["x-operator-token"]),
        expected,
      )
    ) {
      throw unauthorized(
        "invalid_operator_token",
        "A valid operator token is required.",
      );
    }
    return true;
  }
}

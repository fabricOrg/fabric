import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { unauthorized } from "../http/api-error.js";
import { readSingleHeader, secretsMatch } from "../http/shared-secret.js";

interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  method?: string;
}

@Injectable()
export class WebhookTokenGuard implements CanActivate {
  private readonly logger = new Logger(WebhookTokenGuard.name);

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
      // A rejected callback used to be SILENT, and silence is indistinguishable from a carrier that
      // never called at all. A misconfigured callback URL therefore looked exactly like a provider
      // with no delivery reports: messages sat `accepted` until the sweeper expired them, and the
      // only way to notice was to compare `updated_at` against the send time by hand.
      //
      // Never log the presented value: it is a credential, and a near-miss (trailing newline, a
      // truncated paste) would put most of the real secret in the log. Which slot it arrived in and
      // whether anything arrived at all is what an operator needs, and it is enough to tell
      // "wrong token" from "no token" from "wrong URL".
      this.logger.warn(
        `Rejected webhook ingress: provider=${request.params?.provider ?? "unknown"} ` +
          `method=${request.method ?? "?"} ` +
          `credential=${describePresented(presented, expected)}`,
      );
      throw unauthorized(
        "invalid_webhook_token",
        "A valid webhook token is required.",
      );
    }
    return true;
  }
}

/**
 * Says what was wrong with the credential WITHOUT disclosing it. `absent` and `mismatched` are the
 * two operators act on differently: absent means the callback URL is missing its `?token=`
 * (or the header), mismatched means it carries the wrong one — most often the local value rather
 * than the deployed one.
 */
function describePresented(presented: string | null, expected: string): string {
  if (expected.length === 0) return "server-misconfigured (no expected token)";
  if (presented === null || presented.length === 0) return "absent";
  return "mismatched";
}

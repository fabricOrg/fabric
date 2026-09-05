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
  /** Raw request target, query string included and undecoded (Fastify populates this). */
  url?: string;
}

@Injectable()
export class WebhookTokenGuard implements CanActivate {
  private readonly logger = new Logger(WebhookTokenGuard.name);

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("WEBHOOK_INGRESS_TOKEN") ?? "";
    const request = context.switchToHttp().getRequest<WebhookRequest>();
    // Prefer the header; fall back to a `?token=` query param for GET callbacks that can't set
    // headers (e.g. Arkesel DLRs).
    //
    // The query value is taken from the RAW url, not the parsed query object, because the parsed one
    // is form-decoded: `+` becomes a SPACE. A base64 secret containing `+` therefore authenticated
    // fine as a header and failed as a query param — silently, on every carrier delivery report,
    // which is exactly how this went unnoticed. `decodeURIComponent` undoes percent-encoding (so an
    // operator who correctly wrote `%2B` also works) while leaving a literal `+` alone, so both
    // spellings of the same secret match.
    const presented =
      readSingleHeader(request.headers["x-webhook-token"]) ||
      rawQueryToken(request.url) ||
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
        `Rejected webhook ingress: provider=${safeSlug(request.params?.provider)} ` +
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
 * The provider path segment, safe to put in a log line.
 *
 * It is attacker-controlled and percent-decoded by the router, so interpolating it raw let an
 * UNAUTHENTICATED caller inject newlines and forge log entries — including a convincing
 * "credential=ok" line. Anything outside the slug alphabet is dropped, and the result is clamped so
 * a long path cannot pad the log.
 */
function safeSlug(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) return "unknown";
  const cleaned = value.replace(/[^a-zA-Z0-9._:-]/g, "");
  return cleaned.length === 0 ? "unrecognised" : cleaned.slice(0, 40);
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

/**
 * The `token` query value exactly as it appeared on the wire, percent-decoded but NOT form-decoded.
 *
 * Deliberately hand-parsed rather than routed through `URLSearchParams`, whose `get()` applies the
 * form decoding this exists to avoid.
 */
function rawQueryToken(url: string | undefined): string | null {
  if (!url) return null;
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return null;
  for (const pair of url.slice(queryStart + 1).split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq) !== "token") continue;
    const raw = pair.slice(eq + 1);
    if (raw.length === 0) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed percent-escape is not a token. Return null rather than the undecoded value so
      // the parsed-query fallback below still gets a turn — returning `raw` short-circuited the
      // chain and made that fallback unreachable, which the comment claimed the opposite of.
      return null;
    }
  }
  return null;
}

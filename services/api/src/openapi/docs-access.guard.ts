import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { notFound, unauthorized } from "../http/api-error.js";
import { readSingleHeader, secretsMatch } from "../http/shared-secret.js";

/**
 * Gate on the docs surface. This serves the FULL specification, which describes `/internal/admin/*`
 * — kill switches, impersonation, wallet adjustment, staff management. Treat it as staff surface.
 *
 * FAILS CLOSED, and that is a deliberate contrast with `http/edge-origin-guard.ts`, which returns
 * `true` when its secret is unset. That posture is defensible for an edge check whose absence
 * should not brick provider webhooks; it is indefensible here, where an unset variable would
 * publish the admin surface. The two guards sit in the same request path with opposite postures
 * ON PURPOSE — do not "make them consistent" without re-reading this paragraph.
 *
 * Unset token -> 404, not 401. A 401 confirms the endpoint exists and invites guessing; 404 makes a
 * disabled docs surface indistinguishable from one that was never built. Wrong token -> 401, so an
 * operator who HAS configured it can tell "not enabled" from "you sent the wrong value".
 */
@Injectable()
export class DocsAccessGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = (this.config.get<string>("OPERATOR_TOKEN") ?? "").trim();
    if (expected.length === 0) {
      throw notFound("not_found", "Not found.");
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    // TWO ways in, and deliberately no `?token=` third one. A browser NAVIGATING to /docs cannot
    // set a custom header, so a header-only gate would make the UI unopenable and push the next
    // person toward a query-string token — which lands in history, bookmarks, referrers and proxy
    // logs. HTTP Basic is the browser-native way to get a credential into a header on navigation.
    //   - `x-operator-token`     : curl, CI, the rest of the control plane
    //   - `Authorization: Basic` : browsers. Any username; the token is the PASSWORD.
    const presented =
      readSingleHeader(request.headers["x-operator-token"]) ??
      basicAuthPassword(request.headers.authorization);
    if (!secretsMatch(presented, expected)) {
      // Without this header a browser shows a bare 401 body and never offers a login prompt, so the
      // Basic path above would be unusable in practice. `realm` is what the prompt displays.
      context
        .switchToHttp()
        .getResponse<{ header: (name: string, value: string) => void }>()
        .header("WWW-Authenticate", 'Basic realm="Fabric API docs"');
      throw unauthorized(
        "invalid_operator_token",
        "A valid operator token is required.",
      );
    }
    return true;
  }
}

/** The password half of `Authorization: Basic base64(user:password)`, or null if absent/malformed. */
function basicAuthPassword(
  header: string | string[] | undefined,
): string | null {
  const value = readSingleHeader(header);
  if (!value?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(value.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  const password = decoded.slice(separator + 1);
  return password.length > 0 ? password : null;
}

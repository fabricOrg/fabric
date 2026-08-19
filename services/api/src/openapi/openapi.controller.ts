import {
  Controller,
  Get,
  Header,
  Inject,
  Res,
  UseGuards,
} from "@nestjs/common";
import { DocsAccessGuard } from "./docs-access.guard.js";
import { OpenApiService } from "./openapi.service.js";

/**
 * The operator-facing documentation surface. Serves the FULL specification — `/internal/admin/*`
 * included — so every route here is behind `DocsAccessGuard`, which fails closed.
 *
 * NOT under `/v1`: this is not part of the versioned customer API, and its bindings are
 * `visibility: "internal"`, so it is absent from the PUBLIC artifact. It does appear in the internal
 * one — which is correct and worth stating plainly, because the comment here used to claim it was
 * excluded from its own spec, and it never was.
 */
/** Structural reply shape — fastify is not a direct dependency of this package. */
interface ReplyLike {
  status(code: number): unknown;
}

@Controller("docs")
@UseGuards(DocsAccessGuard)
export class OpenApiController {
  /** Rendered once per process: the document cannot change without a restart. */
  private rendered: string | null = null;

  constructor(
    @Inject(OpenApiService) private readonly openapi: OpenApiService,
  ) {}

  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  // Belt and braces: a token-gated page must never be cached by an intermediary.
  @Header("cache-control", "no-store")
  @Header("x-robots-tag", "noindex, nofollow")
  async page(@Res({ passthrough: true }) reply: ReplyLike): Promise<string> {
    if (this.rendered) return this.rendered;
    try {
      this.rendered = docsPage(await this.openapi.servedDocument());
      return this.rendered;
    } catch {
      // 503, not 200. A page whose body reads "unavailable" while its status says OK is a lie a
      // monitor believes; `passthrough` sets the status without taking over serialisation.
      reply.status(503);
      // ANSWER IN HTML, ALWAYS. `servedDocument()` throws a 503 whose message names the exact
      // command that fixes it — but `@Header` has already stamped `text/html` on this reply, and
      // Nest's Fastify adapter only repairs the content-type when the error body carries a
      // `statusCode` key, which our envelope does not. The JSON envelope therefore goes out under
      // `text/html` and dies in Fastify's serializer as
      // `500 Attempted to send payload of invalid type 'object'` — destroying the one message an
      // operator needed, at the only moment it exists. Measured, not theorised: that is verbatim
      // what `/docs` returned with the artifact missing.
      //
      // `wallet.controller.ts` avoids `@Header` for this same reason, and the response interceptor
      // repoints the content-type before throwing. This page is HTML either way, so it degrades to
      // an HTML page rather than juggling the header.
      return DOCS_UNAVAILABLE_HTML;
    }
  }

  @Get("openapi.json")
  @Header("cache-control", "no-store")
  document(): Promise<Record<string, unknown>> {
    return this.openapi.servedDocument();
  }
}

/**
 * Scalar renders the spec. It is loaded from a CDN rather than vendored: this is an internal ops
 * page, the request is made by the operator's browser (not by the API), and vendoring a bundled
 * viewer would put ~4MB of third-party JS in the repo for a page a handful of people open. If the
 * environment ever forbids external script origins, vendor it then — the spec endpoint is unchanged.
 *
 * PINNED AND HASHED, because the trust model here is not the usual one. This page is opened with a
 * staff Basic credential and carries the full internal specification inline. An unpinned
 * `@scalar/api-reference` meant any future release — or a compromised CDN — would execute in this
 * API's origin in a staff browser with that document already in the DOM. `integrity` makes
 * substituted bytes fail to execute; the pin makes the bytes predictable. Bump both together.
 *
 * THE DOCUMENT IS EMBEDDED, NOT FETCHED, and that is the fix for a page that rendered its shell and
 * then said "Document 'api-1' could not be loaded" on the deployed environment.
 *
 * WHAT IS ESTABLISHED: handing Scalar a `url` makes the BROWSER issue a second request for the
 * document, and that request failed on the deployed environment while `/docs/openapi.json` answered
 * 200 to curl. WHAT IS NOT: exactly why. The obvious suspect is the Basic credential not being
 * replayed on the sub-request, but nobody measured it, and this comment is not the place to record
 * a guess as a cause — `content` is the fix because it deletes the dependency, not because the
 * dependency was diagnosed.
 *
 * One thing to correct for whoever reads this next: Scalar DOES have a fetch hook, spelled
 * `customFetch`. The old code passed `fetch`, which is not a configuration key, so it was ignored —
 * but even spelled correctly it would have changed nothing, because `fetch()` already defaults to
 * `credentials: "same-origin"`. It read like protection and was a no-op twice over.
 *
 * `content` is documented, removes the second request altogether, and cannot desynchronise from what
 * `/docs/openapi.json` would have served because both come from `servedDocument()`.
 */
function docsPage(document: Record<string, unknown>): string {
  // `<` is escaped so a string anywhere in the document cannot close this script tag early. The
  // document is ours, but "the data is trusted" is exactly the assumption that turns an injection
  // into an incident, and the escape costs nothing.
  const embedded = JSON.stringify(document).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Fabric API — internal reference</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.65.1"
            integrity="sha384-NAMzfHXRsxRYhcKmRnZGVLvlBeXTWtpYd0jWgeZ7fk89X95GIJBK1H4bUwkP4IZJ"
            crossorigin="anonymous"></script>
    <script>
      Scalar.createApiReference('#app', { content: ${embedded} });
    </script>
  </body>
</html>`;
}

/**
 * Shown when the specification cannot be assembled. Names the command that fixes it, because the
 * audience is an operator who can run it, and says nothing else — the guard has already established
 * they hold the operator token, but a failure page is still a poor place to volunteer internals.
 */
const DOCS_UNAVAILABLE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Fabric API — reference unavailable</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 42rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.6">
    <h1 style="font-size: 1.25rem">The API reference is not available</h1>
    <p>The OpenAPI artifact could not be read, so there is nothing to render.</p>
    <p>Generate it and restart the service:</p>
    <pre style="background: #f4f4f5; padding: 0.75rem; border-radius: 0.375rem; overflow-x: auto"><code>pnpm --filter @app/api openapi:generate</code></pre>
    <p>If this is a deployed environment, the artifact is missing from the image rather than from the
    repository — check that <code>docs/api/openapi.internal.json</code> ships, or set
    <code>OPENAPI_INTERNAL_PATH</code>.</p>
  </body>
</html>`;

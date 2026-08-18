import { Controller, Get, Header, Inject, UseGuards } from "@nestjs/common";
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
@Controller("docs")
@UseGuards(DocsAccessGuard)
export class OpenApiController {
  constructor(
    @Inject(OpenApiService) private readonly openapi: OpenApiService,
  ) {}

  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  // Belt and braces: a token-gated page must never be cached by an intermediary.
  @Header("cache-control", "no-store")
  @Header("x-robots-tag", "noindex, nofollow")
  page(): string {
    return DOCS_HTML;
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
 * staff Basic credential and fetches the full internal specification with `credentials:
 * "same-origin"`. An unpinned `@scalar/api-reference` meant any future release — or a compromised
 * CDN — would execute in this API's origin in a staff browser and could exfiltrate that document
 * using the credential the browser attaches for it. `integrity` makes substituted bytes fail to
 * execute; the pin makes the bytes predictable. Bump both together, never one alone.
 *
 * The spec is fetched with `credentials: "same-origin"` so the Basic credential the browser already
 * holds for this realm is reused; the token is never re-entered and never lands in a URL.
 */
const DOCS_HTML = `<!doctype html>
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
      Scalar.createApiReference('#app', {
        url: '/docs/openapi.json',
        fetch: (input, init) =>
          fetch(input, { ...init, credentials: 'same-origin' }),
      });
    </script>
  </body>
</html>`;

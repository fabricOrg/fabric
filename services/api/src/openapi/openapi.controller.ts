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
  async page(): Promise<string> {
    return docsPage(await this.openapi.servedDocument());
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
 * then said "Document 'api-1' could not be loaded" on the deployed environment. Handing Scalar a
 * `url` makes the BROWSER fetch it as a second request, and that request did not carry the Basic
 * credential the page itself was opened with. The `fetch` override that was supposed to solve it —
 * passing `credentials: "same-origin"` — is not a supported configuration option, so it was silently
 * ignored; it read like protection and did nothing. `content` is documented, removes the second
 * request altogether, and cannot desynchronise from what `/docs/openapi.json` would have served
 * because both come from `servedDocument()`.
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

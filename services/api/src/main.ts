import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import type { Http2ServerRequest } from "node:http2";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { edgeOriginAllowed } from "./http/edge-origin-guard.js";
import { resolveRequestId } from "./http/logging.config.js";
import {
  isPublicApiPath,
  parseAllowedOrigins,
  publicCorsOrigin,
  varyWithOrigin,
} from "./http/public-cors.js";
import { RequestContractInterceptor } from "./http/request-contract.interceptor.js";
import { ResponseEnvelopeInterceptor } from "./http/response-envelope.interceptor.js";
import { assertRequiredSecrets } from "./runtime/required-secrets.js";

/**
 * services/api — the public API app (L1 scaffold). NestJS on the Fastify adapter. This process is
 * where per-request tenant context is established: guards resolve the tenant, handlers run their
 * data access through @app/db's `withTenant` (the RLS runtime seam). Fastify for throughput.
 */
async function bootstrap(): Promise<void> {
  // BEFORE the container starts. Both master keys are read lazily, so an invalid one otherwise
  // yields a service that boots, reports healthy, and fails at the first credential install or send.
  assertRequiredSecrets();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Request id lives at the FASTIFY layer (its id wins over pino-http's under this adapter):
    // honor a well-formed inbound x-request-id, else mint req_… — validation in resolveRequestId.
    // requestIdHeader stays false so the raw header can't bypass that validation.
    new FastifyAdapter({
      genReqId: (req: IncomingMessage | Http2ServerRequest) =>
        resolveRequestId(req),
      requestIdHeader: false,
    }),
    // bufferLogs: hold early boot logs until the pino logger below takes over — nothing unstructured.
    { rawBody: true, bufferLogs: true },
  );
  // All Nest `Logger` calls (SmsService, MaintenanceService, …) now emit structured pino JSON.
  app.useLogger(app.get(Logger));
  // One response shape for the whole API: `{ data, request_id }` on every JSON success. Applied
  // globally rather than per-handler so a new controller cannot forget it (contracts/envelope.ts).
  // Order matters: the request check runs on the way IN, the envelope wraps on the way OUT.
  app.useGlobalInterceptors(
    new RequestContractInterceptor(),
    new ResponseEnvelopeInterceptor(),
  );
  const edgeSharedSecret = process.env.EDGE_SHARED_SECRET;
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onRequest", (request, reply, done) => {
      if (edgeOriginAllowed(request, edgeSharedSecret)) {
        done();
        return;
      }
      reply.code(403).send({
        error: "forbidden",
        message: "Requests must use the protected edge endpoint.",
      });
    });
  // Echo the id to the caller so a support ticket can quote the exact request.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onRequest", (request, reply, done) => {
      reply.header("x-request-id", request.id);
      done();
    });
  // CORS for the PUBLIC prefix ONLY. The marketing site renders the published rate card by fetching
  // /v1/public/pricing from the browser; without this header the response is fetched successfully
  // and then discarded by the browser, so the page silently shows no prices.
  //
  // Scoped to `/v1/public/` on purpose, never globally: the rest of /v1/* is the sk_*-authenticated
  // data plane and /internal/* takes BFF_INTERNAL_TOKEN. Neither may become cross-origin readable.
  //
  // Origins come from PUBLIC_CORS_ALLOWED_ORIGINS and are echoed individually rather than answered
  // with `*`, so only our own sites can read this in a browser. Parsed ONCE at boot — this runs on
  // every response. `Vary: Origin` is mandatory alongside an echoed origin: the shared CDN cache in
  // front of this route would otherwise serve one origin's response (and its allow-origin value) to
  // another. It does mean one cached object per origin instead of one globally.
  //
  // onSend, not an @Header decorator on the controller: "no public book is published" is a
  // legitimate 404, and a decorator would not put the header on that error response — the browser
  // would report an opaque CORS failure instead of a readable 404 the site can handle.
  const publicCorsOrigins = parseAllowedOrigins(
    process.env.PUBLIC_CORS_ALLOWED_ORIGINS,
  );
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", (request, reply, _payload, done) => {
      if (isPublicApiPath(request.url)) {
        const origin = publicCorsOrigin(
          request.headers.origin,
          publicCorsOrigins,
        );
        // Vary goes on every public response, matched or not: whether the header appears at all is
        // itself origin-dependent, so a cache keyed without Origin would still cross the wires.
        // Merged rather than set — these responses already vary on Accept-Encoding.
        reply.header(
          "vary",
          varyWithOrigin(reply.getHeader("vary")?.toString()),
        );
        if (origin) reply.header("access-control-allow-origin", origin);
      }
      done();
    });
  app.enableShutdownHooks(); // so DbModule.onModuleDestroy closes the pool cleanly
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();

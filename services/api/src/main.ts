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

/**
 * services/api — the public API app (L1 scaffold). NestJS on the Fastify adapter. This process is
 * where per-request tenant context is established: guards resolve the tenant, handlers run their
 * data access through @app/db's `withTenant` (the RLS runtime seam). Fastify for throughput.
 */
async function bootstrap(): Promise<void> {
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
  app.enableShutdownHooks(); // so DbModule.onModuleDestroy closes the pool cleanly
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();

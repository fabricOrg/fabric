import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

/**
 * services/api — the public API app (L1 scaffold). NestJS on the Fastify adapter. This process is
 * where per-request tenant context is established: guards resolve the tenant, handlers run their
 * data access through @app/db's `withTenant` (the RLS runtime seam). Fastify for throughput.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableShutdownHooks(); // so DbModule.onModuleDestroy closes the pool cleanly
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();

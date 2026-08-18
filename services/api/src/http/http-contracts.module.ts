import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { RequestContractInterceptor } from "./request-contract.interceptor.js";
import { ResponseEnvelopeInterceptor } from "./response-envelope.interceptor.js";

/**
 * The two interceptors that make the published contracts real: one checks an incoming body and
 * query string against the schema the document publishes, the other wraps every JSON success in
 * `{ data, request_id }` and validates it on the way out.
 *
 * REGISTERED AS `APP_INTERCEPTOR`, NOT VIA `app.useGlobalInterceptors()`. That distinction is the
 * whole reason this module exists.
 *
 * `useGlobalInterceptors` runs inside `bootstrap()` in `main.ts`. Every integration spec in this
 * service builds its own app with `NestFactory.create(AppModule, …)` and never calls bootstrap — so
 * with the interceptors registered there, NO TEST IN THE REPO HAD EVER SEEN THE ENVELOPE. Twenty-four
 * suites asserted the pre-envelope shape and stayed green while a real process returned something
 * else. An independent review found this; nothing in the pipeline could have.
 *
 * As DI providers they are part of `AppModule`, so anything that builds the module gets them —
 * tests included. `RequestLogsModule` already used this pattern; following it would have avoided the
 * gap entirely.
 *
 * ORDER MATTERS and is the registration order below: the request check runs on the way in, the
 * envelope wraps and validates on the way out.
 */
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestContractInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class HttpContractsModule {}

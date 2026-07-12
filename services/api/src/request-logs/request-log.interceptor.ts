import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { type Observable, tap } from "rxjs";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import { newRequestId } from "../http/api-error.js";
import { RequestLogService } from "./request-log.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
  method?: string;
  url?: string;
}

/**
 * Captures one request_logs row per CUSTOMER public-API request (W-B). Global, but records only when
 * a real `sk_*` key authenticated the request — it skips unauthenticated traffic (no `req.tenant`)
 * and the dashboard's own BFF tenant-token calls (`bfft_` keyId), which aren't the developer's API
 * usage. Capture is fire-and-forget via RequestLogService.record() (never awaited, never throws), so
 * logging can't slow or fail the request. Runs for both success (tap next) and error (tap error).
 */
@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  constructor(
    @Inject(RequestLogService) private readonly logs: RequestLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const start = Date.now();

    const capture = (statusCode: number): void => {
      const tenant = req.tenant;
      if (!tenant || tenant.keyId.startsWith("bfft_")) return;
      this.logs.record({
        tenantId: tenant.id,
        applicationId: tenant.applicationId,
        environmentId: tenant.environmentId,
        method: req.method ?? "GET",
        path: (req.url ?? "").split("?")[0] ?? "",
        statusCode,
        requestId: newRequestId(),
        latencyMs: Date.now() - start,
        keyId: tenant.keyId,
      });
    };

    return next.handle().pipe(
      tap({
        next: () =>
          capture(
            http.getResponse<{ statusCode?: number }>().statusCode ?? 200,
          ),
        error: (err) =>
          capture(err instanceof HttpException ? err.getStatus() : 500),
      }),
    );
  }
}

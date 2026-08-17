import { unwrapEnvelope } from "./envelope.js";
import {
  ApiError,
  ConnectionError,
  errorForStatus,
  FabricError,
  RateLimitError,
  TimeoutError,
  UserAbortedError,
} from "./errors.js";
import type { FabricResponse, WriteOptions } from "./types.js";

const PROTECTED_HEADERS = new Set([
  "authorization",
  "idempotency-key",
  "user-agent",
]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
/**
 * Codes a backoff cannot clear, despite arriving on a normally-retryable status.
 *
 * A sandbox allowance is a DAILY quota, not a rate limit — it refills at midnight UTC, not in a few
 * hundred milliseconds. Retrying it spends the caller's whole retry budget and adds seconds of
 * latency to a request that was never going to succeed.
 */
const NON_RETRYABLE_CODES = new Set(["sandbox_daily_limit_exceeded"]);

export interface FabricLogger {
  debug(
    event: "request" | "response" | "retry",
    metadata: Readonly<Record<string, unknown>>,
  ): void;
}

export interface TransportConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly fetch: typeof globalThis.fetch;
  readonly logger?: FabricLogger;
  readonly sdkVersion: string;
}

interface RequestInput {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly options?: WriteOptions;
}

export class Transport {
  constructor(private readonly config: TransportConfig) {}

  async request<T>(input: RequestInput): Promise<FabricResponse<T>> {
    this.validateHeaders(input.options?.headers);
    const canRetry =
      input.method === "GET" || input.options?.idempotencyKey !== undefined;
    let retryCount = 0;
    while (true) {
      let retryDelay: number | undefined;
      try {
        const response = await this.attempt<T>(input, retryCount);
        if (
          !RETRYABLE_STATUSES.has(response.statusCode) ||
          !canRetry ||
          retryCount >= this.config.maxRetries
        ) {
          return response;
        }
      } catch (error) {
        if (!this.shouldRetryError(error, canRetry, retryCount)) throw error;
        retryDelay =
          error instanceof RateLimitError && error.retryAfter !== undefined
            ? error.retryAfter * 1_000
            : undefined;
      }
      retryCount += 1;
      this.log("retry", {
        method: input.method,
        path: input.path,
        retryCount,
      });
      try {
        await delay(retryDelay ?? backoff(retryCount), input.options?.signal);
      } catch (error) {
        throw new UserAbortedError("The request was cancelled by the caller.", {
          code: "request_aborted",
          cause: error,
        });
      }
    }
  }

  private async attempt<T>(
    input: RequestInput,
    retryCount: number,
  ): Promise<FabricResponse<T>> {
    const timeout = input.options?.timeout ?? this.config.timeout;
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort("sdk-timeout"),
      timeout,
    );
    const signal = AbortSignal.any([
      timeoutController.signal,
      ...(input.options?.signal ? [input.options.signal] : []),
    ]);
    const headers = new Headers(input.options?.headers);
    headers.set("authorization", `Bearer ${this.config.apiKey}`);
    headers.set("user-agent", `fabric-node/${this.config.sdkVersion}`);
    if (input.body !== undefined)
      headers.set("content-type", "application/json");
    if (input.options?.idempotencyKey)
      headers.set("idempotency-key", input.options.idempotencyKey);
    this.log("request", {
      method: input.method,
      path: input.path,
      retryCount,
    });
    try {
      const response = await this.config.fetch(
        new URL(input.path, this.config.baseUrl),
        {
          method: input.method,
          headers,
          signal,
          ...(input.body !== undefined
            ? { body: JSON.stringify(input.body) }
            : {}),
        },
      );
      const requestId = response.headers.get("x-request-id") ?? undefined;
      const payload =
        response.status === 204 ? undefined : await parseBody(response);
      if (!response.ok) throw mapApiError(response, payload, requestId);
      this.log("response", {
        method: input.method,
        path: input.path,
        statusCode: response.status,
        requestId,
        retryCount,
      });
      const resolvedRequestId = requestId ?? requestIdFrom(payload);
      // Fabric wraps every JSON success in `{ data, request_id }`. Unwrapped once here so every
      // resource module keeps receiving the payload it already expects — the envelope is a
      // transport concern. Errors are thrown above and keep their own envelope untouched.
      return {
        data: unwrapEnvelope(payload) as T,
        ...(resolvedRequestId ? { requestId: resolvedRequestId } : {}),
        retryCount,
        statusCode: response.status,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (input.options?.signal?.aborted) {
        throw new UserAbortedError("The request was cancelled by the caller.", {
          code: "request_aborted",
          cause: error,
        });
      }
      if (timeoutController.signal.aborted) {
        throw new TimeoutError(
          `The request exceeded the ${timeout}ms timeout.`,
          { code: "request_timeout", retryable: true, cause: error },
        );
      }
      throw new ConnectionError(
        "Fabric could not be reached. Check your network connection and retry.",
        { code: "connection_error", retryable: true, cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private shouldRetryError(
    error: unknown,
    canRetry: boolean,
    retryCount: number,
  ): boolean {
    return (
      canRetry &&
      retryCount < this.config.maxRetries &&
      error instanceof FabricError &&
      error.retryable
    );
  }

  private validateHeaders(
    headers: Readonly<Record<string, string>> | undefined,
  ): void {
    for (const name of Object.keys(headers ?? {})) {
      if (PROTECTED_HEADERS.has(name.toLowerCase())) {
        throw new TypeError(
          `The protected header \`${name}\` cannot be overridden.`,
        );
      }
    }
  }

  private log(
    event: "request" | "response" | "retry",
    metadata: Readonly<Record<string, unknown>>,
  ): void {
    try {
      this.config.logger?.debug(event, metadata);
    } catch {
      // Observability is deliberately best-effort: a broken logger must not fail a message request.
    }
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  if (!response.headers.get("content-type")?.includes("application/json"))
    return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function mapApiError(
  response: Response,
  payload: unknown,
  requestId?: string,
): ApiError {
  const envelope =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const body =
    typeof envelope.error === "object" && envelope.error !== null
      ? (envelope.error as Record<string, unknown>)
      : {};
  const message =
    typeof body.message === "string"
      ? body.message
      : `Fabric returned HTTP ${response.status}.`;
  const code = typeof body.code === "string" ? body.code : "api_error";
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
  const resolvedRequestId = requestId ?? requestIdFrom(payload);
  return errorForStatus(response.status, message, {
    code,
    statusCode: response.status,
    ...(resolvedRequestId ? { requestId: resolvedRequestId } : {}),
    details: body,
    retryable:
      RETRYABLE_STATUSES.has(response.status) && !NON_RETRYABLE_CODES.has(code),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
  });
}

function requestIdFrom(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as Record<string, unknown>).request_id;
  return typeof value === "string" ? value : undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}

function backoff(attempt: number): number {
  const ceiling = Math.min(250 * 2 ** (attempt - 1), 4_000);
  return Math.floor(Math.random() * ceiling);
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

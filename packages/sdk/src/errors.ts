export interface FabricErrorOptions {
  readonly code?: string;
  readonly statusCode?: number;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export class FabricError extends Error {
  readonly code: string;
  readonly statusCode: number | undefined;
  readonly requestId: string | undefined;
  readonly details: unknown;
  readonly retryable: boolean;

  constructor(message: string, options: FabricErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? "sdk_error";
    this.statusCode = options.statusCode;
    this.requestId = options.requestId;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export class ApiError extends FabricError {}
export class AuthenticationError extends ApiError {}
export class AuthorizationError extends ApiError {}
export class ValidationError extends ApiError {}
export class RateLimitError extends ApiError {
  readonly retryAfter: number | undefined;

  constructor(
    message: string,
    options: FabricErrorOptions & { retryAfter?: number } = {},
  ) {
    super(message, options);
    this.retryAfter = options.retryAfter;
  }
}
export class ConflictError extends ApiError {}
export class NotFoundError extends ApiError {}
export class TimeoutError extends FabricError {}
export class ConnectionError extends FabricError {}
export class UserAbortedError extends FabricError {}
export class WebhookVerificationError extends FabricError {}
export class ResponseValidationError extends FabricError {}

export function errorForStatus(
  statusCode: number,
  message: string,
  options: FabricErrorOptions & { retryAfter?: number },
): ApiError {
  if (statusCode === 401) return new AuthenticationError(message, options);
  if (statusCode === 403) return new AuthorizationError(message, options);
  if (statusCode === 400 || statusCode === 422)
    return new ValidationError(message, options);
  if (statusCode === 404) return new NotFoundError(message, options);
  if (statusCode === 409) return new ConflictError(message, options);
  if (statusCode === 429) return new RateLimitError(message, options);
  return new ApiError(message, options);
}

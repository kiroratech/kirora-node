import { ERROR_CODES } from './error-codes.js';
import type { components } from './models.js';

export type ErrorCode = (typeof ERROR_CODES)[number];
export type FieldError = components['schemas']['FieldError'];

const KNOWN_CODES = new Set<string>(ERROR_CODES);

/**
 * An error returned by the Kirora API. Branch on `code`.
 *
 * `code` also accepts unknown strings, since the API may add codes before this package
 * is updated. Use `isKnownCode()` to tell them apart.
 */
export class KiroraError extends Error {
  readonly code: ErrorCode | (string & {});
  readonly status: number;
  /** Each field the request got wrong, on `VALIDATION_ERROR` and `DRAFT_INCOMPLETE`. */
  readonly errors: FieldError[];
  /** Depends on the code; see that code's description. */
  readonly details: unknown;
  readonly requestId: string | undefined;
  /** From the `Retry-After` header, if any. */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    errors?: FieldError[];
    details?: unknown;
    requestId?: string;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'KiroraError';
    this.code = init.code;
    this.status = init.status;
    this.errors = init.errors ?? [];
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** False for codes added after this version of the package. */
  isKnownCode(): boolean {
    return KNOWN_CODES.has(this.code);
  }

  /**
   * True for 429 and 5xx. This only says the request might succeed if repeated; for
   * writes, only retry with an idempotency key.
   */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/**
 * The request never got a complete response, e.g. a DNS or connection failure, or the
 * connection dropped while reading the body. The message uses the underlying cause,
 * since Node's `fetch` just says "fetch failed".
 */
export class KiroraConnectionError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`${operation} failed: ${innermostReason(cause)}`, { cause });
    this.name = 'KiroraConnectionError';
  }
}

/** An attempt took longer than `timeoutMs`. Retried like any other connection error. */
export class KiroraTimeoutError extends KiroraConnectionError {
  constructor(operation: string, timeoutMs: number, cause: unknown) {
    super(operation, cause);
    this.name = 'KiroraTimeoutError';
    this.message = `${operation} timed out after ${timeoutMs}ms`;
  }
}

/**
 * The API answered with a success status but a body this package can't use, such as
 * HTML from a proxy or JSON without the expected envelope. Not retried.
 */
export class KiroraResponseError extends Error {
  readonly status: number;
  readonly requestId: string | undefined;

  constructor(init: {
    message: string;
    status: number;
    requestId?: string;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'KiroraResponseError';
    this.status = init.status;
    this.requestId = init.requestId;
  }
}

/** Why a webhook failed verification. */
export type WebhookVerificationFailure =
  'invalid_timestamp' | 'signature_mismatch' | 'timestamp_outside_tolerance';

/** Thrown by `assertWebhookSignature()`. Respond with a 4xx and don't process the body. */
export class KiroraWebhookVerificationError extends Error {
  readonly reason: WebhookVerificationFailure;

  constructor(reason: WebhookVerificationFailure, message: string) {
    super(message);
    this.name = 'KiroraWebhookVerificationError';
    this.reason = reason;
  }
}

function innermostReason(error: unknown): string {
  // Tracks where it's been, since a custom fetch could reject with a cyclic cause chain.
  // An empty message, as on an empty AggregateError, keeps the last one found.
  const seen = new Set<unknown>();
  let message = error instanceof Error ? error.name : String(error);
  for (let reason = error; reason !== undefined && !seen.has(reason);) {
    seen.add(reason);
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- whatever a custom fetch threw
    if (!(reason instanceof Error)) return String(reason);
    if (reason.message) message = reason.message;
    // A refused dual-stack connection is an AggregateError with an empty message.
    reason =
      reason instanceof AggregateError && !reason.message
        ? reason.errors[0]
        : reason.cause;
  }
  return message;
}

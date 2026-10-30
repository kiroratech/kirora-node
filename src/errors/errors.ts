import { ERROR_CODES } from './error-codes.js';
import type { components } from '../models.js';

/** An error code in `ERROR_CODES`, the codes this version of the SDK knows. */
export type ErrorCode = (typeof ERROR_CODES)[number];
/** A field the request got wrong, with a message to show beside it. */
export type FieldError = components['schemas']['FieldError'];

const KNOWN_CODES = new Set<string>(ERROR_CODES);

/** The rate limit a response reported, from its `RateLimit-*` headers. */
export type RateLimit = {
  /** Requests allowed in each window. */
  readonly limit: number;
  /** Requests left in the current window. */
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly resetSeconds: number;
};

/** An error response from the API. Branch on its `code`. */
export class KiroraError extends Error {
  /**
   * What went wrong, for code to branch on. A code added to the API after this version of
   * the SDK still comes through, as a string; `isKnownCode()` tells you which.
   */
  readonly code: ErrorCode | (string & {});
  readonly status: number;
  /**
   * On `VALIDATION_ERROR` and `DRAFT_INCOMPLETE`, each field the request got wrong.
   * Otherwise empty.
   */
  readonly errors: FieldError[];
  /** What else the error carries, depending on `code`. */
  readonly details: unknown;
  /** Quote this to Kirora support. */
  readonly requestId: string | undefined;
  /** How long the API asked you to wait before trying again, from `Retry-After`. */
  readonly retryAfterSeconds: number | undefined;
  /** Undefined unless the response had valid `RateLimit-*` headers. */
  readonly rateLimit: RateLimit | undefined;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    errors?: FieldError[];
    details?: unknown;
    requestId?: string;
    retryAfterSeconds?: number;
    rateLimit?: RateLimit;
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
    this.rateLimit = init.rateLimit;
  }

  /** Whether `code` is one of `ERROR_CODES`. */
  isKnownCode(): boolean {
    return KNOWN_CODES.has(this.code);
  }

  /**
   * Whether the same request might succeed later: a 429, a 5xx, or
   * `IDEMPOTENCY_KEY_IN_USE` while an earlier request with the same key is still running.
   * A write repeated without an idempotency key can still be applied twice.
   */
  get isRetryable(): boolean {
    return (
      this.status === 429 || this.status >= 500 || this.code === 'IDEMPOTENCY_KEY_IN_USE'
    );
  }
}

/**
 * A request that got no complete response, such as after a network error, or a
 * connection that dropped while the body was read. `cause` holds the underlying error.
 */
export class KiroraConnectionError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`${operation} failed: ${innermostReason(cause)}`, { cause });
    this.name = 'KiroraConnectionError';
  }
}

/** An attempt that took longer than `timeoutMs`. */
export class KiroraTimeoutError extends KiroraConnectionError {
  constructor(operation: string, timeoutMs: number, cause: unknown) {
    super(operation, cause);
    this.name = 'KiroraTimeoutError';
    this.message = `${operation} timed out after ${timeoutMs}ms`;
  }
}

/** A response the SDK can't use, such as an HTML page from a proxy with a 200 status. */
export class KiroraResponseError extends Error {
  readonly status: number;
  /** Quote this to Kirora support. */
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

/**
 * Why a webhook failed verification. `signature_mismatch` usually means the wrong secret,
 * or a body that was parsed before it was verified. `timestamp_outside_tolerance` means a
 * replay, or a server clock out of sync. `invalid_headers` means the signature, event or
 * event id header is missing or differs from the body's, or the attempt header isn't a
 * whole number from 1.
 */
export type WebhookVerificationFailure =
  | 'invalid_timestamp'
  | 'signature_mismatch'
  | 'timestamp_outside_tolerance'
  | 'invalid_headers';

/**
 * Thrown by `assertWebhook()`, `assertWebhookSignature()` and `assertWebhookHeaders()` for
 * a webhook that fails verification.
 */
export class KiroraWebhookVerificationError extends Error {
  readonly reason: WebhookVerificationFailure;

  constructor(reason: WebhookVerificationFailure, message: string) {
    super(message);
    this.name = 'KiroraWebhookVerificationError';
    this.reason = reason;
  }
}

/**
 * Yields `error` and each error down its `cause` chain, stopping at a cycle. Node's
 * `fetch` fails with just "fetch failed", and keeps the useful reason down that chain.
 * When every address of a host refuses the connection, that reason is an
 * `AggregateError`, with one error per address and no message of its own.
 */
export function* causeChain(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  for (let reason = error; reason !== undefined && !seen.has(reason);) {
    seen.add(reason);
    yield reason;
    if (!(reason instanceof Error)) return;
    reason =
      reason instanceof AggregateError && !reason.message
        ? reason.errors[0]
        : reason.cause;
  }
}

function innermostReason(error: unknown): string {
  let message = error instanceof Error ? error.name : String(error);
  for (const reason of causeChain(error)) {
    if (!(reason instanceof Error)) return String(reason);
    if (reason.message) message = reason.message;
  }
  return message;
}

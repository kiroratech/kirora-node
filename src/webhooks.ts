import { createHmac, timingSafeEqual } from 'node:crypto';
import { KiroraWebhookVerificationError } from './errors.js';
import { checkNumber } from './lib.js';
import type { WEBHOOK_EVENTS } from './webhook-events.js';

/** Requests with a timestamp further than this from now are rejected as replays. */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookVerificationOptions = {
  /** How far the timestamp may be from now, in seconds. Defaults to 300. */
  toleranceSeconds?: number;
  /** The current time in milliseconds, for tests. Defaults to `Date.now()`. */
  now?: number;
};

/**
 * Verifies a webhook's signature and timestamp, throwing a
 * `KiroraWebhookVerificationError` that says why if it fails. The signature is
 * `sha256=` followed by the hex HMAC-SHA256 of `${timestamp}.${rawBody}`, keyed with the
 * signing secret.
 *
 * Pass the raw request body exactly as received. Parsed and re-serialized JSON won't
 * match the signature.
 *
 * Throws a `RangeError` instead if the options are invalid, or an `Error` if `secret` is
 * empty, rather than skipping a check.
 */
export function assertWebhookSignature(
  secret: string,
  rawBody: string | Buffer,
  signature: string,
  timestamp: string,
  options: WebhookVerificationOptions = {},
): void {
  if (!secret) {
    throw new Error('secret is required');
  }
  const tolerance = checkNumber(
    'toleranceSeconds',
    options.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
    (value) => Number.isFinite(value) && value >= 0,
    'a finite number of seconds of at least 0',
  );
  const now = checkNumber(
    'now',
    options.now ?? Date.now(),
    Number.isFinite,
    'a finite number of milliseconds',
  );
  const seconds = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(seconds)) {
    throw new KiroraWebhookVerificationError(
      'invalid_timestamp',
      'The timestamp header is missing or not a number of seconds',
    );
  }
  const expected = `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex')}`;
  const expectedBytes = Buffer.from(expected);
  // During secret rotation the header has one signature per secret.
  const matched = signature.split(',').some((candidate) => {
    const receivedBytes = Buffer.from(candidate.trim());
    // timingSafeEqual throws if the lengths differ, so check them first.
    return (
      expectedBytes.length === receivedBytes.length &&
      timingSafeEqual(expectedBytes, receivedBytes)
    );
  });
  if (!matched) {
    throw new KiroraWebhookVerificationError(
      'signature_mismatch',
      'No signature matches the body: check the secret, and pass the raw body unparsed',
    );
  }
  // Checked after the signature, so a stale timestamp is only reported when it's genuine.
  const ageSeconds = Math.floor(now / 1000) - seconds;
  if (Math.abs(ageSeconds) > tolerance) {
    throw new KiroraWebhookVerificationError(
      'timestamp_outside_tolerance',
      `The timestamp is ${Math.abs(ageSeconds)}s ${ageSeconds > 0 ? 'old' : 'in the future'}, beyond the ${tolerance}s tolerance: a replay, or a clock out of sync`,
    );
  }
}

/**
 * Like `assertWebhookSignature()`, but returns false instead of throwing when the
 * webhook fails verification. Invalid options still throw.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string | Buffer,
  signature: string,
  timestamp: string,
  options: WebhookVerificationOptions = {},
): boolean {
  try {
    assertWebhookSignature(secret, rawBody, signature, timestamp, options);
    return true;
  } catch (error) {
    if (error instanceof KiroraWebhookVerificationError) return false;
    throw error;
  }
}

/** Also accepts unknown strings, since new event types can be added at any time. */
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | (string & {});

export type WebhookHeaders = {
  event: WebhookEvent;
  /** The same across retries of an event, so use it to deduplicate. */
  eventId: string;
  attempt: number;
  timestamp: string;
  signature: string;
};

/**
 * Reads Kirora's webhook headers from Node's `req.headers` or a fetch `Headers`. Returns
 * undefined if any required one is missing or empty, or the attempt isn't a whole number
 * from 1. A missing attempt is 1.
 */
export function readWebhookHeaders(
  headers: Headers | Record<string, string | string[] | undefined>,
): WebhookHeaders | undefined {
  let get: (name: string) => string | undefined;
  if (headers instanceof Headers) {
    get = (name) => headers.get(name) ?? undefined;
  } else {
    // Node lowercases header names, but a plain object passed in might not be.
    const lookup = new Map(
      Object.entries(headers).map(([name, value]) => [
        name.toLowerCase(),
        Array.isArray(value) ? value[0] : value,
      ]),
    );
    get = (name) => lookup.get(name);
  }
  const event = get('x-webhook-event');
  const eventId = get('x-webhook-event-id');
  const timestamp = get('x-webhook-timestamp');
  const signature = get('x-webhook-signature');
  const attemptHeader = get('x-webhook-attempt') ?? '1';
  const attempt = Number(attemptHeader);
  if (
    !event ||
    !eventId ||
    !timestamp ||
    !signature ||
    !/^[1-9]\d*$/.test(attemptHeader) ||
    !Number.isSafeInteger(attempt)
  ) {
    return undefined;
  }
  return { event, eventId, attempt, timestamp, signature };
}

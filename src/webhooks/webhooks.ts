import { createHmac, timingSafeEqual } from 'node:crypto';
import { KiroraWebhookVerificationError } from '../errors/errors.js';
import { checkNumber, isObject, parseJson } from '../validation.js';
import type { WEBHOOK_EVENTS } from './webhook-events.js';

/**
 * How far a webhook's timestamp may be from now, in seconds, before it's rejected as a
 * replay: 5 minutes.
 */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

/** Options for `assertWebhookSignature()` and `verifyWebhookSignature()`. */
export type WebhookVerificationOptions = {
  /**
   * How far the timestamp may be from now, in seconds, either way. Defaults to
   * `DEFAULT_WEBHOOK_TOLERANCE_SECONDS`.
   */
  toleranceSeconds?: number;
  /** The time to check against, in milliseconds since the epoch. Defaults to now. */
  now?: number;
};

/**
 * Checks that a webhook came from Kirora, and throws a `KiroraWebhookVerificationError`
 * saying why if it didn't. Pass the raw request body, before any JSON parsing, and the
 * `signature` and `timestamp` from `readWebhookHeaders()`. An empty secret or an invalid
 * option throws an `Error` or `RangeError` instead.
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
  let matched = false;
  // Every candidate is compared, so the time taken doesn't reveal which one matched.
  for (const candidate of signature.split(',')) {
    const receivedBytes = Buffer.from(candidate.trim());
    // `timingSafeEqual` throws, rather than returning false, when the lengths differ.
    if (
      expectedBytes.length === receivedBytes.length &&
      timingSafeEqual(expectedBytes, receivedBytes)
    ) {
      matched = true;
    }
  }
  if (!matched) {
    throw new KiroraWebhookVerificationError(
      'signature_mismatch',
      'No signature matches the body: check the secret, and pass the raw body unparsed',
    );
  }
  // Checked after the signature, so a webhook rejected as too old or too new is one
  // Kirora did sign.
  const ageSeconds = Math.floor(now / 1000) - seconds;
  if (Math.abs(ageSeconds) > tolerance) {
    throw new KiroraWebhookVerificationError(
      'timestamp_outside_tolerance',
      `The timestamp is ${Math.abs(ageSeconds)}s ${ageSeconds > 0 ? 'old' : 'in the future'}, beyond the ${tolerance}s tolerance: a replay, or a clock out of sync`,
    );
  }
}

/**
 * Returns whether a webhook came from Kirora, checked as `assertWebhookSignature()`
 * checks it. An empty secret or an invalid option still throws.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string | Buffer,
  signature: string,
  timestamp: string,
  options: WebhookVerificationOptions = {},
): boolean {
  return (
    unlessRefused(() => {
      assertWebhookSignature(secret, rawBody, signature, timestamp, options);
      return true;
    }) ?? false
  );
}

// Returns undefined for a webhook that fails verification, and throws anything else.
function unlessRefused<T>(check: () => T): T | undefined {
  try {
    return check();
  } catch (error) {
    if (error instanceof KiroraWebhookVerificationError) return undefined;
    throw error;
  }
}

/**
 * A webhook event type, one of `WEBHOOK_EVENTS`. A type added to the API after this
 * version of the SDK still comes through, as a string.
 */
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | (string & {});

/** The headers Kirora sends with each webhook, as `readWebhookHeaders()` returns them. */
export type WebhookHeaders = {
  event: WebhookEvent;
  /** The same on every delivery attempt of an event, so deduplicate on it. */
  eventId: string;
  /** Which delivery attempt this is, from 1. */
  attempt: number;
  /** Seconds since the epoch. Pass it to `verifyWebhookSignature()` as it is. */
  timestamp: string;
  signature: string;
};

type IncomingHeaders = Headers | Record<string, string | string[] | undefined>;

/**
 * Reads Kirora's headers from a webhook request, given a fetch `Headers` or Node's
 * `request.headers`, and throws a `KiroraWebhookVerificationError` saying why if one is
 * missing or malformed. Verify the request with `assertWebhookSignature()` before trusting
 * them.
 */
export function assertWebhookHeaders(headers: IncomingHeaders): WebhookHeaders {
  let get: (name: string) => string | undefined;
  if (headers instanceof Headers) {
    get = (name) => headers.get(name) ?? undefined;
  } else {
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
  if (!timestamp) {
    throw new KiroraWebhookVerificationError(
      'invalid_timestamp',
      'The timestamp header is missing',
    );
  }
  if (!signature) {
    throw new KiroraWebhookVerificationError(
      'invalid_headers',
      'The signature header is missing',
    );
  }
  if (!event || !eventId) {
    throw new KiroraWebhookVerificationError(
      'invalid_headers',
      'The event or event id header is missing',
    );
  }
  const attempt = Number(attemptHeader);
  if (!/^[1-9]\d*$/.test(attemptHeader) || !Number.isSafeInteger(attempt)) {
    throw new KiroraWebhookVerificationError(
      'invalid_headers',
      "The attempt header isn't a whole number from 1",
    );
  }
  return { event, eventId, attempt, timestamp, signature };
}

/**
 * Reads Kirora's headers from a webhook request, as `assertWebhookHeaders()` does, but
 * returns undefined if one is missing or malformed. The signature doesn't cover `event`
 * and `eventId`: use `verifyWebhook()`, or take `eventType` and `eventId` from the
 * verified body.
 */
export function readWebhookHeaders(headers: IncomingHeaders): WebhookHeaders | undefined {
  return unlessRefused(() => assertWebhookHeaders(headers));
}

/** A webhook's body: the event, with the fields every event has. */
export type WebhookPayload = {
  /** The same on every delivery attempt of an event, so deduplicate on it. */
  eventId: string;
  eventType: WebhookEvent;
  [field: string]: unknown;
};

/** A webhook that passed `assertWebhook()`. */
export type VerifiedWebhook = {
  /** The request's headers, whose `event` and `eventId` match the body's. */
  headers: WebhookHeaders;
  payload: WebhookPayload;
};

/**
 * Checks that a webhook came from Kirora, as `assertWebhookHeaders()` and
 * `assertWebhookSignature()` do, and that its event headers match the signed body. Returns
 * the headers and the parsed body. Pass the raw request body, before any JSON parsing.
 * Throws a `KiroraWebhookVerificationError` saying why a webhook fails, with
 * `invalid_headers` if the event or event id header differs from the body's.
 */
export function assertWebhook(
  secret: string,
  rawBody: string | Buffer,
  headers: IncomingHeaders,
  options: WebhookVerificationOptions = {},
): VerifiedWebhook {
  const read = assertWebhookHeaders(headers);
  assertWebhookSignature(secret, rawBody, read.signature, read.timestamp, options);
  const payload = parseJson(rawBody.toString());
  // The signature covers only the timestamp and body, so the headers could have been
  // changed on a replay.
  if (
    !isObject(payload) ||
    payload.eventId !== read.eventId ||
    payload.eventType !== read.event
  ) {
    throw new KiroraWebhookVerificationError(
      'invalid_headers',
      "The event or event id header doesn't match the signed body",
    );
  }
  return { headers: read, payload: payload as WebhookPayload };
}

/**
 * Checks a webhook as `assertWebhook()` does, and returns its headers and parsed body, or
 * undefined if it fails. An empty secret or an invalid option still throws.
 */
export function verifyWebhook(
  secret: string,
  rawBody: string | Buffer,
  headers: IncomingHeaders,
  options: WebhookVerificationOptions = {},
): VerifiedWebhook | undefined {
  return unlessRefused(() => assertWebhook(secret, rawBody, headers, options));
}

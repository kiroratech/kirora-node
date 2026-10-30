import { randomUUID } from 'node:crypto';
import {
  causeChain,
  KiroraConnectionError,
  KiroraError,
  KiroraResponseError,
  KiroraTimeoutError,
} from '../errors/errors.js';
import { isObject } from '../validation.js';
import { OPERATIONS, type RETRY_KINDS } from './operations.js';

/**
 * How an operation may be retried, from the spec's `x-retry`:
 * - `read` changes nothing.
 * - `converges` leaves the same end state however often it's repeated.
 * - `state` moves a resource to a state, which a repeat can't do twice.
 * - `done` finishes or removes something, which a repeat finds already done.
 * - `entries` is a batch whose entries each carry an idempotency key.
 * - `key` and `unsafe` can do their work twice, so need an idempotency key.
 * - `unique` creates something unique, which a repeat after success is refused.
 */
type RetryKind = (typeof RETRY_KINDS)[number];

export type Operation = {
  /** The spec's `operationId`. */
  readonly id: string;
  readonly retry?: RetryKind;
  /** Whether the operation takes an `Idempotency-Key` header. */
  readonly acceptsKey: boolean;
  /** For `entries`, the body's array whose entries take their own idempotency keys. */
  readonly entries?: string;
};

const SAFE_WITHOUT_KEY = new Set<RetryKind | undefined>([
  'read',
  'converges',
  'state',
  'done',
  'entries',
]);
// Codes of a connection that was never made, so the API never saw the request.
const UNSENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

let templates: Map<string, { segments: string[]; operation: Operation }[]> | undefined;

/**
 * Finds the operation whose path template matches `segments`, the path split on `/`. Of
 * several matches, the one with the most literal segments wins, as `/v1/templates/gallery`
 * is a closer match than `/v1/templates/{id}`.
 */
export function operationFor(method: string, segments: string[]): Operation | undefined {
  if (templates === undefined) {
    templates = new Map();
    for (const [key, operation] of Object.entries(OPERATIONS)) {
      const [templateMethod, path] = key.split(' ') as [string, string];
      const list = templates.get(templateMethod) ?? [];
      list.push({ segments: path.split('/'), operation });
      templates.set(templateMethod, list);
    }
  }
  let best = -1;
  let found: Operation | undefined;
  for (const template of templates.get(method) ?? []) {
    if (template.segments.length !== segments.length) continue;
    let literals = 0;
    for (const [index, segment] of template.segments.entries()) {
      if (segment.startsWith('{')) continue;
      if (segment !== segments[index]) {
        literals = -1;
        break;
      }
      literals++;
    }
    if (literals > best) {
      best = literals;
      found = template.operation;
    }
  }
  return found;
}

/**
 * Whether a call can be repeated without doing its work twice. On an endpoint missing
 * from the spec this SDK was built from, the caller's key is trusted to make it safe.
 * `unsafe` is for a call whose arguments make a repeat unsafe on an endpoint that would
 * otherwise allow it.
 */
export function isSafeToRetry(
  method: string,
  operation: Operation | undefined,
  key: string | undefined,
  repeatable: boolean | undefined,
  unsafe: boolean,
): boolean {
  const keyed = key !== undefined && (operation === undefined || operation.acceptsKey);
  const safe = operation
    ? SAFE_WITHOUT_KEY.has(operation.retry)
    : ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method);
  return keyed || (repeatable ?? (safe && !unsafe));
}

/**
 * Whether a call to `updateContact` changes the email or `externalId` the contact is
 * looked up by, so that a retry after the first attempt succeeded would look it up by its
 * old value. The API matches an email trimmed and without case.
 */
export function changesContactLookup(
  operation: Operation | undefined,
  segments: string[],
  query: Readonly<Record<string, unknown>> | undefined,
  body: unknown,
): boolean {
  if (operation?.id !== 'updateContact' || !isObject(body)) return false;
  let id: string;
  try {
    id = decodeURIComponent(segments.at(-1)!);
  } catch {
    return false;
  }
  const email = (value: string) => value.trim().toLowerCase();
  const changes = (value: unknown, same: (value: string) => boolean) =>
    value === null || (typeof value === 'string' && !same(value));
  switch (query?.idType) {
    case 'email':
      return changes(body.email, (value) => email(value) === email(id));
    case 'externalId':
      return changes(body.externalId, (value) => value === id);
    default:
      return false;
  }
}

/**
 * Whether a 404 is success: after an attempt that may have reached the server, which may
 * have done the delete.
 */
export function notFoundIsDone(
  method: string,
  operation: Operation | undefined,
): boolean {
  return (
    method === 'DELETE' &&
    (operation?.retry === 'done' || operation?.retry === 'converges')
  );
}

/**
 * Gives each entry of the body's `entries` array without an idempotency key a new one,
 * so a retried batch can't repeat an entry. Returns any other body as it is.
 */
export function withEntryKeys(body: unknown, entries: string | undefined): unknown {
  if (entries === undefined || !isObject(body) || !Array.isArray(body[entries])) {
    return body;
  }
  return {
    ...body,
    [entries]: (body[entries] as unknown[]).map((entry) =>
      isObject(entry) && (entry.idempotencyKey ?? null) === null
        ? { ...entry, idempotencyKey: randomUUID() }
        : entry,
    ),
  };
}

/** Whether `error` is worth another attempt of a call that is or isn't `safe` to repeat. */
export function shouldRetry(error: unknown, safe: boolean): boolean {
  // The API did nothing with the request, so even one unsafe to repeat can be sent again.
  if (neverReached(error)) return true;
  if (!safe) return false;
  if (error instanceof KiroraConnectionError) return true;
  return error instanceof KiroraError && error.isRetryable;
}

/** Whether `error` shows the API never acted on the request. */
export function neverReached(error: unknown): boolean {
  if (error instanceof KiroraError) return error.status === 429;
  return (
    error instanceof KiroraConnectionError &&
    !(error instanceof KiroraTimeoutError) &&
    connectionNeverMade(error.cause)
  );
}

/**
 * Whether the attempt that failed with `error` may have done its work. A 503 without the
 * API's request id came from a load balancer that didn't pass the request on.
 */
export function mayHaveRun(error: unknown): boolean {
  if (error instanceof KiroraError && error.status === 503 && !error.requestId) {
    return false;
  }
  return !neverReached(error);
}

/** Whether `error` came from a response the API sent. */
export function isApiAnswer(error: unknown): boolean {
  return error instanceof KiroraError || error instanceof KiroraResponseError;
}

// Every address of a host must have failed to connect, not just the first.
function connectionNeverMade(error: unknown): boolean {
  for (const reason of causeChain(error)) {
    const { code } = (reason ?? {}) as { code?: unknown };
    if (typeof code === 'string' && UNSENT_CODES.has(code)) return true;
    if (reason instanceof AggregateError && reason.errors.length > 0) {
      return reason.errors.every(connectionNeverMade);
    }
  }
  return false;
}

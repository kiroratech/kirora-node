import {
  KiroraConnectionError,
  KiroraError,
  KiroraResponseError,
  KiroraTimeoutError,
  type FieldError,
} from './errors.js';
import { PagePromise, type Page } from './pagination.js';
import { checkNumber } from './lib.js';

export type RetryOptions = {
  /** Attempts after the first, from 0 (no retries) to 10. */
  readonly maxRetries?: number;
  /** Ceiling for a single backoff wait, in milliseconds. */
  readonly maxDelayMs?: number;
};

export type ClientOptions = {
  /** Defaults to the `KIRORA_API_KEY` environment variable. */
  readonly apiKey?: string;
  /** Defaults to `https://api.kirora.io`. Without a version, since paths include `/v1`. */
  readonly baseUrl?: string;
  /** A custom `fetch`, e.g. for tests or a proxy. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * How long each attempt may take, in milliseconds, including reading the response.
   * Each retry gets a fresh timeout, so a call that retries can take longer overall.
   */
  readonly timeoutMs?: number;
  readonly retry?: RetryOptions;
  /**
   * For partner keys: the `externalId` of the tenant workspace to act in. Omit it to use
   * the key's own workspace.
   */
  readonly workspace?: string;
};

export type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * Sent as JSON, or as multipart if it's a `FormData`. Captured once per call, so
   * changing it while the call retries has no effect.
   */
  body?: unknown;
  /** Generate it once per operation, not per attempt, so retries reuse it. */
  idempotencyKey?: string;
  /** Overrides the client's `workspace` for this call. */
  workspace?: string;
  /** Safe to retry without an idempotency key, e.g. an upsert. */
  repeatable?: boolean;
  /** Cancels the call, including any wait before a retry. It rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Overrides the client's `timeoutMs` for this call. */
  timeoutMs?: number;
  /** Overrides the client's `retry.maxRetries` for this call. */
  maxRetries?: number;
};

/** The HTTP response a result came from, as its non-enumerable `lastResponse`. */
export type ResponseInfo = {
  status: number;
  headers: Headers;
  requestId: string | undefined;
  /**
   * True when the idempotency key matched an earlier request, so this is that request's
   * stored response and nothing was done again.
   */
  idempotencyReplay: boolean;
};

export type WithResponse<T> = T & { readonly lastResponse: ResponseInfo };

/** Idempotent HTTP methods. */
const REPEATABLE_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);

const DEFAULTS = { timeoutMs: 30_000, maxRetries: 3, maxDelayMs: 30_000 };
/** The longest delay `setTimeout` supports. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const MAX_RETRIES = 10;

/** What a successful response must look like: anything, `{ data }`, or a page. */
type Shape = 'any' | 'data' | 'page';

/** A request built once per call and replayed unchanged on each attempt. */
type Prepared = {
  operation: string;
  url: URL;
  init: { method: string; headers: Record<string, string>; body: RequestInit['body'] };
  /** Whether repeating it can't cause a duplicate. */
  repeatable: boolean;
};

export class KiroraClient {
  /** As given, with the resolved key, for `withWorkspace()` to copy. */
  private readonly options: ClientOptions;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxDelayMs: number;
  private readonly workspace: string | undefined;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.KIRORA_API_KEY;
    if (!apiKey) {
      throw new Error('apiKey is required: pass it, or set KIRORA_API_KEY');
    }
    this.options = { ...options, apiKey, retry: { ...options.retry } };
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.kirora.io').replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = checkTimeout('timeoutMs', options.timeoutMs ?? DEFAULTS.timeoutMs);
    this.maxRetries = checkRetries(
      'retry.maxRetries',
      options.retry?.maxRetries ?? DEFAULTS.maxRetries,
    );
    this.maxDelayMs = checkNumber(
      'retry.maxDelayMs',
      options.retry?.maxDelayMs ?? DEFAULTS.maxDelayMs,
      (value) => Number.isFinite(value) && value >= 0 && value <= MAX_TIMER_MS,
      `a number of milliseconds from 0 to ${MAX_TIMER_MS}`,
    );
    this.workspace = options.workspace;
  }

  /** A copy of this client that acts in another workspace (partner keys only). */
  withWorkspace(workspace: string): KiroraClient {
    return new KiroraClient({ ...this.options, workspace });
  }

  /**
   * Sends a request, retrying when it's safe to, and resolves with the parsed JSON body,
   * or undefined for a 204 or a `HEAD`. It's for JSON endpoints: any other successful
   * body is a `KiroraResponseError`. An object body also has `lastResponse`, unless it
   * has its own field of that name.
   */
  request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    return this.execute(method, path, options, 'any') as Promise<T>;
  }

  /**
   * Like `request()`, for a response in a `{ data }` envelope. Resolves with `data`, which
   * must be an object or array.
   */
  requestData<T extends object>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<WithResponse<T>> {
    return this.execute(method, path, options, 'data') as Promise<WithResponse<T>>;
  }

  /**
   * A paginated list: await it for the first page, or iterate over it for every item.
   * The cursor is managed for you; pass `query.cursor` to start from a later page.
   *
   * The query and options are copied now, since the API requires the same filters on
   * every page: changing them later doesn't affect this list.
   */
  list<P extends Page<unknown>>(
    path: string,
    options: RequestOptions = {},
  ): PagePromise<P> {
    const { query, ...fixed } = options;
    const filters = { ...query };
    return new PagePromise<P>(
      (cursor) =>
        this.execute(
          'GET',
          path,
          { ...fixed, query: cursor === undefined ? filters : { ...filters, cursor } },
          'page',
        ) as Promise<WithResponse<P>>,
      fixed.signal,
    );
  }

  private async execute(
    method: string,
    path: string,
    options: RequestOptions,
    shape: Shape,
  ): Promise<unknown> {
    const prepared = this.prepare(method, path, options);
    const { signal } = options;
    const timeoutMs =
      options.timeoutMs === undefined
        ? this.timeoutMs
        : checkTimeout('timeoutMs', options.timeoutMs);
    const maxRetries =
      options.maxRetries === undefined
        ? this.maxRetries
        : checkRetries('maxRetries', options.maxRetries);
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      try {
        return await this.send(prepared, shape, signal, timeoutMs);
      } catch (error) {
        // The caller's cancellation is never retried, nor reported as a network failure.
        if (signal?.aborted) throw signal.reason;
        if (attempt > maxRetries || !shouldRetry(error, prepared.repeatable)) throw error;
        const waitMs = this.backoffMs(attempt, error);
        if (waitMs === undefined) throw error;
        await sleep(waitMs, signal);
      }
    }
  }

  private prepare(method: string, path: string, options: RequestOptions): Prepared {
    // URLs resolve "." and ".." segments, and drop to another route on an empty one, so an
    // id such as ".." would send the request somewhere else. Encoding can't prevent it.
    if (
      path
        .split('/')
        .slice(1)
        .some((segment) => ['', '.', '..'].includes(segment))
    ) {
      throw new TypeError(
        `${method} ${path}: an id in the path can't be empty, "." or ".."`,
      );
    }
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      accept: 'application/json',
    };
    let body: RequestInit['body'];
    if (options.body instanceof FormData) {
      // fetch sets the multipart content type (with boundary). Copying the entries keeps
      // later changes to the caller's form out of retries; the values are immutable.
      body = new FormData();
      for (const [name, value] of options.body) {
        body.append(name, value);
      }
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey !== undefined) {
      headers['idempotency-key'] = options.idempotencyKey;
    }
    const workspace = options.workspace ?? this.workspace;
    if (workspace !== undefined) {
      headers['kirora-workspace'] = workspace;
    }
    return {
      operation: `${method} ${path}`,
      url,
      init: { method, headers, body },
      repeatable:
        REPEATABLE_METHODS.has(method) ||
        options.idempotencyKey !== undefined ||
        options.repeatable === true,
    };
  }

  private async send(
    { operation, url, init }: Prepared,
    shape: Shape,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    // One controller per attempt, aborted by the timeout or the caller. Both are released
    // as soon as the attempt ends, rather than living until the timeout would have fired.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort(signal!.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const failed = (cause: unknown) =>
      controller.signal.aborted && !signal?.aborted
        ? new KiroraTimeoutError(operation, timeoutMs, cause)
        : new KiroraConnectionError(operation, cause);

    let response: Response;
    let text: string;
    try {
      try {
        response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      } catch (cause) {
        throw failed(cause);
      }
      try {
        text = await response.text();
      } catch (cause) {
        // An error status still says what went wrong, even without its body.
        throw response.ok ? failed(cause) : toApiError(response, undefined, cause);
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (!response.ok) {
      throw toApiError(response, parseJson(text));
    }
    if ((response.status === 204 || init.method === 'HEAD') && shape === 'any') {
      return undefined;
    }
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const invalid = (problem: string, cause?: unknown) =>
      new KiroraResponseError({
        message: `${operation} returned ${response.status} ${problem}`,
        status: response.status,
        requestId,
        cause,
      });
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (cause) {
      throw invalid('with a body that is not JSON', cause);
    }
    if (shape === 'data') {
      if (!isObject(payload) || !isObject(payload.data)) {
        throw invalid('without an object or array in a `data` envelope');
      }
      payload = payload.data;
    }
    if (shape === 'page' && !isPage(payload)) {
      throw invalid('without a page of `data` and `meta.pagination`');
    }
    // Non-enumerable, so it stays out of JSON, spreads and equality checks. A payload with
    // its own `lastResponse` keeps it, rather than losing data to the metadata.
    if (isObject(payload) && !Object.hasOwn(payload, 'lastResponse')) {
      Object.defineProperty(payload, 'lastResponse', {
        enumerable: false,
        writable: false,
        configurable: true,
        value: {
          status: response.status,
          headers: response.headers,
          requestId,
          idempotencyReplay: response.headers.get('idempotency-replay') === 'true',
        } satisfies ResponseInfo,
      });
    }
    return payload;
  }

  /**
   * Honours `Retry-After` if present, otherwise uses exponential backoff, with jitter
   * either way. Returns undefined (give up) if `Retry-After` exceeds `maxDelayMs`.
   */
  private backoffMs(attempt: number, error: unknown): number | undefined {
    const retryAfter = error instanceof KiroraError ? error.retryAfterSeconds : undefined;
    if (retryAfter === undefined) {
      const jittered = 2 ** (attempt - 1) * 1_000 * (0.75 + Math.random() * 0.5);
      return Math.min(jittered, this.maxDelayMs);
    }
    const retryAfterMs = retryAfter * 1_000;
    if (retryAfterMs > this.maxDelayMs) return undefined;
    return Math.min(retryAfterMs * (1 + Math.random() * 0.25), this.maxDelayMs);
  }
}

/**
 * A 429 is always safe to retry, since the server did nothing. Other failures might have
 * partly succeeded, so we only retry requests that can't cause duplicates.
 */
function shouldRetry(error: unknown, repeatable: boolean): boolean {
  if (error instanceof KiroraError && error.status === 429) return true;
  if (!repeatable) return false;
  if (error instanceof KiroraConnectionError) return true;
  return error instanceof KiroraError && error.isRetryable;
}

function toApiError(response: Response, payload: unknown, cause?: unknown): KiroraError {
  const error = isObject(payload) && isObject(payload.error) ? payload.error : {};
  const string = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return new KiroraError({
    code: string(error.code) ?? 'INTERNAL_ERROR',
    message: string(error.message) ?? `HTTP ${response.status}`,
    status: response.status,
    errors: Array.isArray(error.errors) ? error.errors.filter(isFieldError) : [],
    details: error.details,
    requestId: response.headers.get('x-request-id') ?? string(error.requestId),
    retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    cause,
  });
}

/** Seconds to wait, from either form of `Retry-After`. Undefined if absent or invalid. */
function parseRetryAfter(header: string | null): number | undefined {
  // Check for null first, since Number(null) is 0 and would mean "retry now".
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  // An HTTP date always has letters (the weekday, month and "GMT"). Without this check,
  // Date.parse would read a negative number such as "-5" as a year.
  if (!/[a-z]/i.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1_000);
}

/** Error bodies needn't be JSON, e.g. an HTML 502 from a proxy. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFieldError(value: unknown): value is FieldError {
  return (
    isObject(value) &&
    typeof value.field === 'string' &&
    typeof value.message === 'string'
  );
}

function isPage(value: unknown): boolean {
  if (!isObject(value) || !Array.isArray(value.data) || !isObject(value.meta)) {
    return false;
  }
  const { pagination } = value.meta;
  return (
    isObject(pagination) &&
    typeof pagination.limit === 'number' &&
    (pagination.nextCursor === null || typeof pagination.nextCursor === 'string')
  );
}

function checkTimeout(name: string, value: unknown): number {
  return checkNumber(
    name,
    value,
    (value) => Number.isInteger(value) && value > 0 && value <= MAX_TIMER_MS,
    `a whole number of milliseconds from 1 to ${MAX_TIMER_MS}`,
  );
}

function checkRetries(name: string, value: unknown): number {
  return checkNumber(
    name,
    value,
    (value) => Number.isInteger(value) && value >= 0 && value <= MAX_RETRIES,
    `a whole number from 0 to ${MAX_RETRIES}`,
  );
}

/** Waits, unless `signal` aborts first, in which case it rejects with the signal's reason. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

import { randomUUID } from 'node:crypto';
import {
  KiroraConnectionError,
  KiroraError,
  KiroraResponseError,
  KiroraTimeoutError,
  type FieldError,
  type RateLimit,
} from '../errors/errors.js';
import { PagePromise, type Page } from './pagination.js';
import {
  isApiAnswer,
  changesContactLookup,
  isSafeToRetry,
  mayHaveRun,
  notFoundIsDone,
  operationFor,
  shouldRetry,
  withEntryKeys,
} from './retry.js';
import { checkNumber, isObject, parseJson } from '../validation.js';
import { VERSION } from './version.js';

/** How failed requests are retried. */
export type RetryOptions = {
  /** Attempts after the first, from 0 to 10. Defaults to 3. */
  readonly maxRetries?: number;
  /**
   * The longest single wait between attempts, in milliseconds. Defaults to 30,000. When
   * the API asks for a longer wait with `Retry-After`, the call fails instead.
   */
  readonly maxDelayMs?: number;
};

/**
 * Options for `new Kirora()` and `new KiroraClient()`. The client copies them when it's
 * created, so later changes to the object have no effect on it.
 */
export type ClientOptions = {
  /**
   * Your API key. If it's undefined or empty, the `KIRORA_API_KEY` environment variable
   * is used; the constructor throws if neither is set. Spaces and quotes around the key
   * are ignored, as from a pasted `.env` value.
   */
  readonly apiKey?: string;
  /**
   * The API host, without `/v1`. Defaults to the `KIRORA_BASE_URL` environment variable,
   * then `https://api.kirora.io`. The constructor throws a `TypeError` if it isn't an
   * absolute URL.
   */
  readonly baseUrl?: string;
  /** A `fetch` to send requests with, such as a proxy-aware one or a test stub. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * How long each attempt may take, including reading the response, in milliseconds.
   * Defaults to 30,000. A call that retries can take longer in total, so pass a `signal`
   * for an overall deadline.
   */
  readonly timeoutMs?: number;
  readonly retry?: RetryOptions;
  /**
   * Partner keys only: the `externalId` of the tenant workspace to act in. See
   * `Kirora.forWorkspace()`. The constructor throws a `TypeError` if it's empty.
   */
  readonly workspace?: string;
  readonly appInfo?: AppInfo;
  /**
   * Headers to send with every request. Those the SDK sets itself, such as
   * `Authorization`, take precedence. A `Kirora-Workspace` header counts as `workspace`.
   * The constructor throws a `TypeError` for an `Idempotency-Key`, which would be shared
   * by every call: pass one per call instead.
   */
  readonly headers?: Readonly<Record<string, string>>;
};

/**
 * Your app, added to the `User-Agent` header. `name` and `version` can't contain spaces
 * or slashes; the client constructor throws a `TypeError` if they do.
 */
export type AppInfo = {
  readonly name: string;
  readonly version?: string;
};

/** Options for one call through `KiroraClient`. */
export type RequestOptions = {
  /** Query parameters. Those that are undefined are left out. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Sent as JSON, or as multipart form data if it's a `FormData`. */
  body?: unknown;
  /**
   * Sent as the `Idempotency-Key` header. Without one, a key is made for an endpoint that
   * takes one, and reused on every attempt. A key lets the call be retried after a network
   * error or a 5xx, unless the endpoint doesn't take keys.
   */
  idempotencyKey?: string;
  /**
   * Overrides the client's `workspace` for this call. The call rejects with a
   * `TypeError` if it's empty.
   */
  workspace?: string;
  /**
   * Whether the call is safe to repeat after a network error or a 5xx. Defaults to what
   * the API spec says of the endpoint; an endpoint newer than this SDK is safe to repeat
   * if it's a `GET`, `HEAD`, `PUT` or `DELETE`. A call with a key is safe whatever this
   * says. A 429, or a connection that was never made, is retried either way.
   */
  repeatable?: boolean;
  /**
   * Headers to send, over the client's `headers`. An `Idempotency-Key` set here counts as
   * `idempotencyKey`.
   */
  headers?: Readonly<Record<string, string>>;
  /**
   * Cancels the call, including any wait before a retry. The call then rejects with the
   * signal's reason, and isn't retried.
   */
  signal?: AbortSignal;
  /** Overrides the client's `timeoutMs` for this call. */
  timeoutMs?: number;
  /** Overrides the client's `retry.maxRetries` for this call. */
  maxRetries?: number;
};

/** The HTTP response a result came from, as its `lastResponse`. */
export type ResponseInfo = {
  status: number;
  headers: Headers;
  /** The `X-Request-Id` header. Quote it to Kirora support. */
  requestId: string | undefined;
  /**
   * True when the API answered with its stored response to an earlier request with the
   * same idempotency key, rather than acting again.
   */
  idempotencyReplay: boolean;
  /** Undefined unless the response had valid `RateLimit-*` headers. */
  rateLimit: RateLimit | undefined;
};

/**
 * A result with the HTTP response it came from as `lastResponse`, which JSON and object
 * spreads leave out.
 */
export type WithResponse<T> = T & { readonly lastResponse: ResponseInfo };

const DEFAULTS = { timeoutMs: 30_000, maxRetries: 3, maxDelayMs: 30_000 };
const MAX_TIMER_MS = 2 ** 31 - 1;
const MAX_RETRIES = 10;
const USER_AGENT = `kirora-node/${VERSION} node/${process.version}`;
const TOKEN = /^[\w.-]+$/;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

type Shape = 'any' | 'data' | 'page' | 'raw';

type Prepared = {
  operation: string;
  url: URL;
  init: { method: string; headers: Record<string, string>; body: RequestInit['body'] };
  repeatable: boolean;
  notFoundIsDone: boolean;
};

/**
 * The HTTP client behind `Kirora`, with its authentication, retries and errors. Use it
 * directly, as `kirora.client`, for endpoints without a resource method.
 */
export class KiroraClient {
  private readonly options: ClientOptions;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxDelayMs: number;
  private readonly workspace: string | undefined;
  private readonly userAgent: string;
  private readonly headers: Record<string, string>;

  /**
   * Throws an `Error` if there's no API key, and a `RangeError` or `TypeError` for an
   * option out of range.
   */
  constructor(options: ClientOptions = {}) {
    const apiKey = (options.apiKey || process.env.KIRORA_API_KEY || '')
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .trim();
    if (!apiKey) {
      throw new Error('apiKey is required: pass it, or set KIRORA_API_KEY');
    }
    const baseUrl =
      options.baseUrl ?? (process.env.KIRORA_BASE_URL || 'https://api.kirora.io');
    if (!URL.canParse(baseUrl) || !new URL(baseUrl).host) {
      throw new TypeError(
        `baseUrl must be an absolute URL, not ${JSON.stringify(baseUrl)}`,
      );
    }
    const split = splitHeaders(options.headers, undefined, options.workspace);
    if (split.idempotencyKey !== undefined) {
      throw new TypeError(
        "headers can't set Idempotency-Key for every call: pass idempotencyKey per call",
      );
    }
    const { workspace, headers } = split;
    this.headers = headers;
    this.options = {
      ...options,
      apiKey,
      baseUrl,
      retry: { ...options.retry },
      appInfo: options.appInfo && { ...options.appInfo },
      headers,
      workspace,
    };
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
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
    this.workspace = workspace;
    this.userAgent = options.appInfo
      ? `${USER_AGENT} ${appProduct(options.appInfo)}`
      : USER_AGENT;
  }

  /**
   * Returns a copy of this client that acts in the tenant workspace with this
   * `externalId`. Partner keys only.
   */
  withWorkspace(workspace: string): KiroraClient {
    return new KiroraClient({ ...this.options, workspace });
  }

  /**
   * Sends a request to `path`, which starts with `/v1`, and resolves with the whole JSON
   * body, or undefined for a 204 or a `HEAD`. Throws a `KiroraError` for an API error, a
   * `KiroraConnectionError` without a complete response, and a `KiroraResponseError` for
   * a body that isn't JSON. A path segment that's empty, `.` or `..` throws a `TypeError`.
   */
  request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    return this.execute(method, path, options, 'any') as Promise<T>;
  }

  /**
   * Sends a request as `request()` does, and resolves with the body's `data`. A body
   * without an object or array in `data` is a `KiroraResponseError`.
   */
  requestData<T extends object>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<WithResponse<T>> {
    return this.execute(method, path, options, 'data') as Promise<WithResponse<T>>;
  }

  /**
   * Sends a request as `request()` does, and resolves with the successful `Response`
   * without reading its body, for a body that isn't JSON or is too large to buffer, such
   * as a CSV export. `timeoutMs` covers each attempt until the response's headers arrive;
   * reading the body is up to you, with no size limit, and `signal` still cancels it. An
   * error status is read and thrown as `request()` throws it.
   */
  requestRaw(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    return this.execute(method, path, options, 'raw') as Promise<Response>;
  }

  /**
   * Lists a paginated endpoint, sending `options.query` with every page. A page without
   * `data` and `meta.pagination` is a `KiroraResponseError`.
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
    let attemptMayHaveRun = false;
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      try {
        return await this.send(prepared, shape, signal, timeoutMs);
      } catch (error) {
        // An earlier attempt may have done the delete.
        if (
          attemptMayHaveRun &&
          prepared.notFoundIsDone &&
          shape === 'any' &&
          error instanceof KiroraError &&
          error.status === 404
        ) {
          return undefined;
        }
        attemptMayHaveRun ||= mayHaveRun(error);
        // The API's answer says more about what happened than the signal's reason.
        if (signal?.aborted) throw isApiAnswer(error) ? error : signal.reason;
        if (attempt > maxRetries || !shouldRetry(error, prepared.repeatable)) throw error;
        const waitMs = this.backoffMs(attempt, error);
        if (waitMs === undefined) throw error;
        await sleep(waitMs, signal);
      }
    }
  }

  private prepare(method: string, path: string, options: RequestOptions): Prepared {
    if (!path.startsWith('/')) {
      throw new TypeError(`${method} ${path}: the path must start with "/"`);
    }
    const segments = path.split('/');
    // `new URL` resolves `.` and `..` segments even when they came from an encoded id,
    // so an id of `..` would send the request to a different endpoint.
    if (segments.slice(1).some((segment) => ['', '.', '..'].includes(segment))) {
      throw new TypeError(
        `${method} ${path}: an id in the path can't be empty, "." or ".."`,
      );
    }
    const {
      idempotencyKey: ownKey,
      workspace: callWorkspace,
      headers: callHeaders,
    } = splitHeaders(options.headers, options.idempotencyKey, options.workspace);
    const endpoint = operationFor(method, segments);
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      ...this.headers,
      ...callHeaders,
      authorization: `Bearer ${this.apiKey}`,
      accept: 'application/json',
      'user-agent': this.userAgent,
    };
    let body: RequestInit['body'];
    if (options.body instanceof FormData) {
      // Copied, so a retry sends the form as it was when called, as JSON bodies are.
      body = new FormData();
      for (const [name, value] of options.body) {
        body.append(name, value);
      }
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(withEntryKeys(options.body, endpoint?.entries));
    }
    const key = ownKey ?? (endpoint?.acceptsKey ? randomUUID() : undefined);
    if (key !== undefined) {
      headers['idempotency-key'] = key;
    }
    const workspace = callWorkspace ?? this.workspace;
    if (workspace !== undefined) {
      headers['kirora-workspace'] = workspace;
    }
    return {
      operation: `${method} ${path}`,
      url,
      init: { method, headers, body },
      repeatable: isSafeToRetry(
        method,
        endpoint,
        key,
        options.repeatable,
        changesContactLookup(endpoint, segments, options.query, options.body),
      ),
      notFoundIsDone: notFoundIsDone(method, endpoint),
    };
  }

  private async send(
    { operation, url, init }: Prepared,
    shape: Shape,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    // Only the timeout aborts `timer`. Unlike a listener on `signal`, `AbortSignal.any`
    // holds its sources weakly, so nothing is left on a long-lived `signal`.
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(), timeoutMs);
    const failed = (cause: unknown) =>
      timer.signal.aborted
        ? new KiroraTimeoutError(operation, timeoutMs, cause)
        : new KiroraConnectionError(operation, cause);

    let response: Response;
    let text: string | undefined;
    try {
      try {
        response = await this.fetchImpl(url, {
          ...init,
          signal: signal ? AbortSignal.any([signal, timer.signal]) : timer.signal,
        });
      } catch (cause) {
        throw failed(cause);
      }
      // The caller reads the body, which `signal` can still cancel.
      if (shape === 'raw' && response.ok) return response;
      try {
        text = await readText(response, MAX_RESPONSE_BYTES);
      } catch (cause) {
        throw response.ok ? failed(cause) : toApiError(response, undefined, cause);
      }
    } finally {
      clearTimeout(timeout);
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    const invalid = (problem: string, cause?: unknown) =>
      new KiroraResponseError({
        message: `${operation} returned ${response.status} ${problem}`,
        status: response.status,
        requestId,
        cause,
      });
    if (text === undefined) {
      const tooLarge = invalid(
        `with a body larger than ${MAX_RESPONSE_BYTES / 1024 / 1024} MiB`,
      );
      // The status still says what went wrong, and whether to retry.
      throw response.ok ? tooLarge : toApiError(response, undefined, tooLarge);
    }
    if (!response.ok) {
      throw toApiError(response, parseJson(text));
    }
    const noBody =
      response.status === 204 || init.method === 'HEAD' || text.trim() === '';
    if (noBody && shape === 'any') {
      return undefined;
    }
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
    // Never hides a `lastResponse` field the API itself returned.
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
          rateLimit: parseRateLimit(response.headers),
        } satisfies ResponseInfo,
      });
    }
    return payload;
  }

  private backoffMs(attempt: number, error: unknown): number | undefined {
    const retryAfter = error instanceof KiroraError ? error.retryAfterSeconds : undefined;
    if (retryAfter === undefined) {
      const jittered = 2 ** (attempt - 1) * 1_000 * (0.75 + Math.random() * 0.5);
      return Math.min(jittered, this.maxDelayMs);
    }
    const retryAfterMs = retryAfter * 1_000;
    // Retrying sooner than the API asked would only be refused again.
    if (retryAfterMs > this.maxDelayMs) return undefined;
    return Math.min(retryAfterMs * (1 + Math.random() * 0.25), this.maxDelayMs);
  }
}

const CODES_BY_STATUS: Record<number, string> = {
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

function toApiError(response: Response, payload: unknown, cause?: unknown): KiroraError {
  const error = isObject(payload) && isObject(payload.error) ? payload.error : {};
  const string = (value: unknown) =>
    typeof value === 'string' && value !== '' ? value : undefined;
  const { status } = response;
  return new KiroraError({
    code:
      string(error.code) ??
      CODES_BY_STATUS[status] ??
      (status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'),
    message: string(error.message) ?? `HTTP ${status}`,
    status,
    errors: Array.isArray(error.errors) ? error.errors.filter(isFieldError) : [],
    details: error.details,
    requestId: response.headers.get('x-request-id') ?? string(error.requestId),
    retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    rateLimit: parseRateLimit(response.headers),
    cause,
  });
}

const MONTH = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const TIME = '\\d{2}:\\d{2}:\\d{2}';
// The three HTTP date formats a recipient must accept: IMF-fixdate, then the obsolete
// RFC 850 and asctime. asctime has no zone, but is always GMT.
const HTTP_DATES = [
  new RegExp(`^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \\d{2} ${MONTH} \\d{4} ${TIME} GMT$`),
  new RegExp(
    `^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \\d{2}-${MONTH}-\\d{2} ${TIME} GMT$`,
  ),
  new RegExp(`^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ${MONTH} [ \\d]\\d ${TIME} \\d{4}$`),
];

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const format = HTTP_DATES.findIndex((pattern) => pattern.test(value));
  if (format === -1) return undefined;
  const date = Date.parse(format === 2 ? `${value} GMT` : value);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1_000);
}

function parseRateLimit(headers: Headers): RateLimit | undefined {
  const [limit, remaining, resetSeconds] = [
    'ratelimit-limit',
    'ratelimit-remaining',
    'ratelimit-reset',
  ].map((name) => {
    const value = headers.get(name)?.trim() ?? '';
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
      ? Number(value)
      : undefined;
  });
  if (limit === undefined || remaining === undefined || resetSeconds === undefined) {
    return undefined;
  }
  return { limit, remaining, resetSeconds };
}

/**
 * Reads the body as text, or returns undefined without reading the rest if it's larger
 * than `maxBytes`.
 */
async function readText(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  // The rest of the body is cancelled without waiting: a body the caller has cloned
  // isn't cancelled until the clone is read or cancelled too.
  if (Number(response.headers.get('content-length')) > maxBytes) {
    response.body?.cancel().catch(() => {});
    return undefined;
  }
  if (response.body === null) return '';
  // Decoded as it arrives, so each chunk can be freed. `TextDecoder` drops a byte order
  // mark, as `text()` does.
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  const iterator = (response.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
    size += next.value.byteLength;
    if (size > maxBytes) {
      iterator.return?.().catch(() => {});
      return undefined;
    }
    parts.push(decoder.decode(next.value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
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

/**
 * Lower-cases `headers`' names and takes out `Idempotency-Key` and `Kirora-Workspace`,
 * which are the options of the same name: an option given explicitly wins over its
 * header. Throws a `TypeError` for an empty key or workspace.
 */
function splitHeaders(
  given: Readonly<Record<string, string>> | undefined,
  idempotencyKey: string | undefined,
  workspace: string | undefined,
) {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(given ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  const key = idempotencyKey ?? headers['idempotency-key'];
  const inWorkspace = workspace ?? headers['kirora-workspace'];
  delete headers['idempotency-key'];
  delete headers['kirora-workspace'];
  if (key === '') throw new TypeError("idempotencyKey can't be an empty string");
  // An empty `Kirora-Workspace` would act in the key's own workspace instead.
  if (inWorkspace === '') {
    throw new TypeError(
      "workspace must be a workspace's externalId, not an empty string",
    );
  }
  return { idempotencyKey: key, workspace: inWorkspace, headers };
}

function appProduct({ name, version }: AppInfo): string {
  checkToken('appInfo.name', name);
  if (version === undefined) return name;
  checkToken('appInfo.version', version);
  return `${name}/${version}`;
}

function checkToken(name: string, value: unknown): void {
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    throw new TypeError(
      `${name} must be letters, digits and .-_ with no spaces or slashes, not ${String(value)}`,
    );
  }
}

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

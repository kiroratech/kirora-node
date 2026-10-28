import { randomUUID } from 'node:crypto';
import type { KiroraClient, RequestOptions, WithResponse } from '../client.js';
import type { components, operations } from '../models.js';
import type { Page, PagePromise } from '../pagination.js';

export type Schemas = components['schemas'];

/** An operation's success response: its 200, else its 201, else its 202. */
type SuccessResponse<Responses> = Responses extends { 200: infer Response }
  ? Response
  : Responses extends { 201: infer Response }
    ? Response
    : Responses extends { 202: infer Response }
      ? Response
      : never;

/** A response's JSON body. Distributes, so a 204's absent response is never too. */
type JsonBody<Response> = Response extends {
  content: { 'application/json': infer Body };
}
  ? Body
  : never;

/** The JSON body of an operation's success response; never for a 204. */
export type ResponseBody<OperationId extends keyof operations> = JsonBody<
  SuccessResponse<operations[OperationId]['responses']>
>;

/** The `data` an operation's success response wraps. */
export type ResultOf<OperationId extends keyof operations> =
  ResponseBody<OperationId> extends { data: infer Data } ? Data : never;

/** The query parameters an operation accepts. */
export type QueryOf<OperationId extends keyof operations> = NonNullable<
  operations[OperationId]['parameters']['query']
>;

/** A page of a list operation's response, with that operation's item and meta types. */
export type PageOf<OperationId extends keyof operations> =
  ResponseBody<OperationId> extends Page<unknown> ? ResponseBody<OperationId> : never;

/** The keys of `CallOptions`. */
const CONTROLS = ['signal', 'workspace', 'timeoutMs', 'maxRetries'] as const;

/**
 * Per-call controls, taken as the last argument of every resource method: `signal`,
 * `workspace`, and `timeoutMs` and `maxRetries` to override the client's settings.
 */
export type CallOptions = Readonly<Pick<RequestOptions, (typeof CONTROLS)[number]>>;

export type IdempotentCallOptions = CallOptions & {
  /**
   * Your own key, such as `receipt-${order.id}`, makes your retries safe too: the API
   * answers a repeat with the first response instead of doing it again.
   */
  readonly idempotencyKey?: string;
};

/** Encodes each value interpolated into a path, such as an id. */
export function path(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce(
    (result, string, index) =>
      result + string + (index < values.length ? encodeURIComponent(values[index]!) : ''),
    '',
  );
}

/** Gives each batch entry without an idempotency key one, once per call, so retries reuse it. */
export function withIdempotencyKeys<Entry extends { idempotencyKey?: string }>(
  entries: Entry[],
): Entry[] {
  return entries.map((entry) => ({
    ...entry,
    idempotencyKey: entry.idempotencyKey ?? randomUUID(),
  }));
}

/** Only the controls, so nothing else a JavaScript caller passes reaches the transport. */
export function controls(options: CallOptions): RequestOptions {
  return Object.fromEntries(CONTROLS.map((name) => [name, options[name]]));
}

export abstract class Resource {
  constructor(protected readonly client: KiroraClient) {}

  /** A single result, unwrapped from its `{ data }` envelope. */
  protected unwrap<T extends object>(
    method: string,
    path: string,
    options: CallOptions,
    request: RequestOptions = {},
  ): Promise<WithResponse<T>> {
    return this.client.requestData<T>(method, path, {
      ...controls(options),
      ...request,
    });
  }

  /**
   * Like `unwrap()`, for an operation that takes an idempotency key: the caller's, or
   * one made for this call, so the library's own retries never repeat it.
   */
  protected unwrapIdempotent<T extends object>(
    method: string,
    path: string,
    { idempotencyKey = randomUUID(), ...options }: IdempotentCallOptions,
    request: RequestOptions = {},
  ): Promise<WithResponse<T>> {
    return this.unwrap(method, path, options, { ...request, idempotencyKey });
  }

  /**
   * Like `unwrap()`, for an operation that's safe to repeat, so it's retried without a
   * key. A key the caller passes is still sent, to replay rather than repeat.
   */
  protected unwrapRepeatable<T extends object>(
    method: string,
    path: string,
    options: IdempotentCallOptions,
    request: RequestOptions = {},
  ): Promise<WithResponse<T>> {
    return this.unwrap(method, path, options, {
      ...request,
      idempotencyKey: options.idempotencyKey,
      repeatable: true,
    });
  }

  /** A DELETE answered with 204 No Content. */
  protected remove(
    path: string,
    options: CallOptions,
    query?: RequestOptions['query'],
  ): Promise<void> {
    return this.client.request('DELETE', path, { ...controls(options), query });
  }

  /** A paginated list. */
  protected page<P extends Page<unknown>>(
    path: string,
    query: RequestOptions['query'],
    options: CallOptions,
  ): PagePromise<P> {
    return this.client.list(path, { ...controls(options), query });
  }
}

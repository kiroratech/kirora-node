import type { KiroraClient, RequestOptions, WithResponse } from '../core/client.js';
import type { components, operations } from '../models.js';
import type { Page, PagePromise } from '../core/pagination.js';

export type Schemas = components['schemas'];

type SuccessResponse<Responses> = Responses extends { 200: infer Response }
  ? Response
  : Responses extends { 201: infer Response }
    ? Response
    : Responses extends { 202: infer Response }
      ? Response
      : never;

type JsonBody<Response> = Response extends {
  content: { 'application/json': infer Body };
}
  ? Body
  : never;

export type ResponseBody<OperationId extends keyof operations> = JsonBody<
  SuccessResponse<operations[OperationId]['responses']>
>;

export type ResultOf<OperationId extends keyof operations> =
  ResponseBody<OperationId> extends { data: infer Data } ? Data : never;

export type QueryOf<OperationId extends keyof operations> = NonNullable<
  operations[OperationId]['parameters']['query']
>;

export type PageOf<OperationId extends keyof operations> =
  ResponseBody<OperationId> extends Page<unknown> ? ResponseBody<OperationId> : never;

const CALL_CONTROLS = [
  'signal',
  'workspace',
  'timeoutMs',
  'maxRetries',
  'headers',
] as const;
const CONTROLS = [...CALL_CONTROLS, 'idempotencyKey'] as const;

/** Options every resource method takes as its last argument. */
export type CallOptions = Readonly<Pick<RequestOptions, (typeof CALL_CONTROLS)[number]>>;

/** `CallOptions` for a method that creates, sends or records something. */
export type IdempotentCallOptions = CallOptions & {
  /**
   * Makes your own retries safe as well as the SDK's. Reuse it only for the same operation
   * and body: the API refuses a key reused with a different body (`IDEMPOTENCY_KEY_REUSED`).
   */
  readonly idempotencyKey?: RequestOptions['idempotencyKey'];
};

export function path(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce(
    (result, string, index) =>
      result + string + (index < values.length ? encodeURIComponent(values[index]!) : ''),
    '',
  );
}

export function controls(options: IdempotentCallOptions): RequestOptions {
  return Object.fromEntries(
    CONTROLS.map((name) => [name, (options as Record<string, unknown>)[name]]),
  );
}

export abstract class Resource {
  constructor(protected readonly client: KiroraClient) {}

  protected unwrap<T extends object>(
    method: string,
    path: string,
    options: IdempotentCallOptions,
    request: RequestOptions = {},
  ): Promise<WithResponse<T>> {
    return this.client.requestData<T>(method, path, {
      ...controls(options),
      ...request,
    });
  }

  protected remove(
    path: string,
    options: CallOptions,
    query?: RequestOptions['query'],
  ): Promise<void> {
    return this.client.request('DELETE', path, { ...controls(options), query });
  }

  protected page<P extends Page<unknown>>(
    path: string,
    query: RequestOptions['query'],
    options: CallOptions,
  ): PagePromise<P> {
    return this.client.list(path, { ...controls(options), query });
  }
}

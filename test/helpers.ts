import { expect } from 'vitest';
import { Kirora, type ClientOptions } from '../src/index.js';

type Call = { url: string; init: RequestInit };

/** Matches a generated idempotency key. */
export const UUID = /^[0-9a-f-]{36}$/;

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/** One page of a list. */
export function page(data: unknown[], nextCursor: string | null = null): Response {
  return json({ data, meta: { pagination: { limit: data.length, nextCursor } } });
}

/** A 204 No Content. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** A 500, which a request is retried after only when that can't cause a duplicate. */
export function serverError(): Response {
  return json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, { status: 500 });
}

/** A 429, with `Retry-After` if given. */
export function rateLimited(retryAfter?: string): Response {
  return json(
    { error: { code: 'RATE_LIMITED', message: 'slow down' } },
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        ...(retryAfter === undefined ? {} : { 'retry-after': retryAfter }),
      },
    },
  );
}

/** A header the client sent. */
export function header(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

/** What a request was, for comparing against a table of expected requests. */
export function sent(call: Call): {
  method: string | undefined;
  path: string;
  body: unknown;
  key: string | null;
} {
  const url = new URL(call.url);
  return {
    method: call.init.method,
    path: url.pathname + url.search,
    body: call.init.body === undefined ? undefined : JSON.parse(call.init.body as string),
    key: header(call, 'idempotency-key'),
  };
}

/** Matches a key the library made, in a `sent()` table. */
export const generated = expect.stringMatching(UUID);

/** The `idempotencyKey` of each entry in a batch the client sent. */
export function entryKeys(call: Call, field: string): string[] {
  return JSON.parse(call.init.body as string)[field].map(
    (entry: { idempotencyKey: string }) => entry.idempotencyKey,
  );
}

export function stubFetch(responses: Response[]): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  // The client always passes a URL, so `.href` is safe.
  const fetch = ((input: URL, init: RequestInit = {}) => {
    calls.push({ url: input.href, init });
    const next = responses.shift();
    if (!next) {
      throw new Error('stub fetch ran out of responses');
    }
    return Promise.resolve(next);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/**
 * A client against a stub that answers with `responses` in turn, retrying quickly.
 * Pass `options.fetch` to use your own stub instead.
 */
export function client(responses: Response[] = [], options: Partial<ClientOptions> = {}) {
  const stub = stubFetch(responses);
  const kirora = new Kirora({
    apiKey: 'kirora_test',
    baseUrl: 'https://api.example.test',
    fetch: stub.fetch,
    retry: { maxRetries: 2, maxDelayMs: 5 },
    ...options,
  });
  return { kirora, calls: stub.calls };
}

import { ReadableStream } from 'node:stream/web';
import { describe, it, expect } from 'vitest';
import {
  Kirora,
  KiroraClient,
  KiroraConnectionError,
  KiroraError,
  KiroraResponseError,
  KiroraTimeoutError,
  type ClientOptions,
} from '../src/index.js';
import {
  client,
  header,
  json,
  noContent,
  rateLimited,
  serverError,
  stubFetch,
} from './helpers.js';

/** A client with its own stub fetch. */
const kirora = (fetch: typeof globalThis.fetch, options: Partial<ClientOptions> = {}) =>
  client([], { fetch, ...options }).kirora;

/** A body that sends its headers, then fails while being read. */
function brokenBody(status = 200): Response {
  const body = new ReadableStream({
    pull(controller) {
      controller.error(new Error('socket closed'));
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

/** Behaves like Node's fetch: rejects with the signal's reason when it aborts. */
function hangingFetch(calls: { count: number }): typeof globalThis.fetch {
  return ((_input: URL, init: RequestInit = {}) => {
    calls.count++;
    return new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), {
        once: true,
      });
    });
  }) as typeof globalThis.fetch;
}

describe('successful responses', () => {
  it('rejects a 200 that is not JSON, rather than resolving with undefined', async () => {
    const { kirora, calls } = client([
      new Response('<html>oops</html>', {
        status: 200,
        headers: { 'x-request-id': 'req_1' },
      }),
    ]);
    const error = await kirora.contacts.get('c1').catch((error: unknown) => error);

    expect(error).toBeInstanceOf(KiroraResponseError);
    expect(error).toMatchObject({ status: 200, requestId: 'req_1' });
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
    expect(calls).toHaveLength(1);
  });

  it('rejects a success without the expected envelope', async () => {
    const { kirora } = client([json({ id: 'c1' }), json({ data: [{ id: 1 }] })]);

    await expect(kirora.contacts.get('c1')).rejects.toThrow(
      /without an object or array in a `data` envelope/,
    );
    await expect(kirora.contacts.list()).rejects.toBeInstanceOf(KiroraResponseError);
  });

  it('rejects data that isn’t an object or array, and a page without its limit', async () => {
    for (const data of [null, 42, 'text']) {
      const { kirora } = client([json({ data })]);
      await expect(kirora.contacts.get('c1')).rejects.toBeInstanceOf(KiroraResponseError);
    }
    const { kirora } = client([
      json({ data: [], meta: { pagination: { nextCursor: null } } }),
      json({ data: [{ id: 'r1' }] }),
    ]);
    await expect(kirora.contacts.list()).rejects.toBeInstanceOf(KiroraResponseError);
    const array = await kirora.client.requestData<object[]>('GET', '/v1/things');
    expect(array).toEqual([{ id: 'r1' }]);
    expect(array.lastResponse.status).toBe(200);
  });

  it('treats a body cut off after the headers as a connection failure, and retries a read', async () => {
    const { kirora, calls } = client([brokenBody(), json({ data: { id: 'c1' } })]);
    await expect(kirora.contacts.get('c1')).resolves.toEqual({ id: 'c1' });
    expect(calls).toHaveLength(2);

    const create = client([brokenBody()]);
    const error = await create.kirora.client
      .request('POST', '/v1/notes', { body: { text: 'hi' } })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(KiroraConnectionError);
    expect((error as Error).message).toContain('socket closed');
    expect(create.calls).toHaveLength(1);
  });

  it('times out while reading a body that never finishes', async () => {
    const fetch = ((_input: URL, init: RequestInit = {}) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal!.addEventListener('abort', () =>
            controller.error(init.signal!.reason),
          );
        },
      });
      return Promise.resolve(new Response(body));
    }) as typeof globalThis.fetch;
    const sdk = kirora(fetch, { timeoutMs: 20, retry: { maxRetries: 0 } });

    await expect(sdk.contacts.get('c1')).rejects.toBeInstanceOf(KiroraTimeoutError);
  });

  it('keeps an error status when its body is unreadable or not JSON', async () => {
    const { kirora } = client([
      new Response('<html>Bad gateway</html>', { status: 502 }),
      new Response('<html>Bad gateway</html>', { status: 502 }),
      new Response('<html>Bad gateway</html>', { status: 502 }),
    ]);
    await expect(kirora.contacts.get('c1')).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL_ERROR',
      message: 'HTTP 502',
    });

    const broken = client([brokenBody(400)]);
    const error = await broken.kirora.contacts.get('c1').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(KiroraError);
    expect(error).toMatchObject({ status: 400 });
    expect(((error as Error).cause as Error).message).toBe('socket closed');
  });

  it('resolves a HEAD with undefined, since it has no body', async () => {
    const { kirora } = client([new Response(null, { status: 200 })]);

    await expect(kirora.client.request('HEAD', '/v1/messages')).resolves.toBeUndefined();
  });

  it('resolves a 204 with undefined', async () => {
    const { kirora } = client([noContent()]);
    await expect(kirora.lists.delete('l1')).resolves.toBeUndefined();
  });
});

describe('cancellation', () => {
  it('never calls fetch with an already-aborted signal', async () => {
    const { fetch, calls } = stubFetch([]);
    const reason = new Error('caller gave up');

    await expect(
      kirora(fetch).contacts.get('c1', {}, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
  });

  it('rejects with the caller’s reason when aborted during fetch, without retrying', async () => {
    const calls = { count: 0 };
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    setTimeout(() => controller.abort(reason), 10);

    await expect(
      kirora(hangingFetch(calls)).contacts.get('c1', {}, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(calls.count).toBe(1);
  });

  it('stops waiting for a retry when aborted during backoff', async () => {
    const { fetch, calls } = stubFetch([serverError()]);
    const sdk = kirora(fetch, { retry: { maxRetries: 2, maxDelayMs: 10_000 } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    const started = Date.now();
    await expect(
      sdk.contacts.get('c1', {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    // The first backoff is at least 750ms.
    expect(Date.now() - started).toBeLessThan(500);
    expect(calls).toHaveLength(1);
  });

  it('retries an attempt that timed out, when the request is safe to repeat', async () => {
    let count = 0;
    const fetch = ((input: URL, init: RequestInit = {}) =>
      ++count === 1
        ? hangingFetch({ count: 0 })(input, init)
        : Promise.resolve(json({ data: { id: 'c1' } }))) as typeof globalThis.fetch;

    await expect(kirora(fetch, { timeoutMs: 20 }).contacts.get('c1')).resolves.toEqual({
      id: 'c1',
    });
    expect(count).toBe(2);
  });

  it('reports a timeout as distinct from a connection failure', async () => {
    const sdk = kirora(hangingFetch({ count: 0 }), {
      timeoutMs: 20,
      retry: { maxRetries: 0 },
    });
    const error = await sdk.contacts.get('c1').catch((error: unknown) => error);

    expect(error).toBeInstanceOf(KiroraTimeoutError);
    expect(error).toBeInstanceOf(KiroraConnectionError);
    expect((error as Error).message).toBe('GET /v1/contacts/c1 timed out after 20ms');
  });
});

describe('paths', () => {
  it('refuses an id that would change the route, without sending anything', async () => {
    const { kirora, calls } = client();

    for (const id of ['', '.', '..']) {
      await expect(kirora.contacts.get(id, { idType: 'externalId' })).rejects.toThrow(
        TypeError,
      );
      await expect(kirora.contacts.update(id, { firstName: 'Ada' })).rejects.toThrow(
        TypeError,
      );
    }
    expect(calls).toHaveLength(0);
  });

  it('encodes any other id as part of the path', async () => {
    const ids = ['...', '.a', 'a b', 'a/b', '50%', 'é', 'a?b', 'a#b'];
    const { kirora, calls } = client(ids.map(() => json({ data: {} })));

    for (const id of ids) {
      await kirora.contacts.get(id);
    }

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(
      ids.map((id) => `/v1/contacts/${encodeURIComponent(id)}`),
    );
  });
});

describe('API errors', () => {
  it('maps an error body onto a typed error rather than throwing on parse', async () => {
    const { kirora } = client([
      json(
        { error: { code: 'CONFLICT', message: 'nope', details: { a: 1 } } },
        { status: 409 },
      ),
    ]);
    await expect(kirora.campaigns.send('x')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      details: { a: 1 },
    });
  });
  it('keeps the field errors, falling back to the body’s request id', async () => {
    const errors = [
      { in: 'body', field: 'email', code: 'invalid_string', message: 'Not an email' },
      { field: 'name', message: 'Too long', maximum: 100 },
    ];
    const { kirora } = client([
      json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'bad',
            errors,
            requestId: 'req_body',
          },
        },
        { status: 400 },
      ),
      json(
        { error: { code: 'VALIDATION_ERROR', message: 'bad', requestId: 'req_body' } },
        { status: 400, headers: { 'x-request-id': 'req_header' } },
      ),
    ]);

    await expect(kirora.lists.create({ name: 'x' })).rejects.toMatchObject({
      errors,
      requestId: 'req_body',
    });
    await expect(kirora.lists.create({ name: 'x' })).rejects.toMatchObject({
      errors: [],
      requestId: 'req_header',
    });
  });

  it('tolerates an unexpected error body', async () => {
    const { kirora } = client([
      json({ error: 'nope', errors: 'not a list' }, { status: 400 }),
      json(
        { error: { code: 1, message: 'm', errors: [{ field: 'a' }, 'x'] } },
        { status: 400 },
      ),
    ]);

    await expect(kirora.lists.create({ name: 'x' })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'HTTP 400',
      errors: [],
    });
    await expect(kirora.lists.create({ name: 'x' })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'm',
      errors: [],
    });
  });

  it('reads Retry-After as seconds or an HTTP date, ignoring a negative value', async () => {
    const inAMinute = new Date(Date.now() + 60_000).toUTCString();
    const { fetch } = stubFetch([rateLimited(inAMinute), rateLimited('-5')]);
    const sdk = kirora(fetch, { retry: { maxRetries: 0 } });

    const fromDate = (await sdk.contacts
      .get('c1')
      .catch((error: unknown) => error)) as KiroraError;
    expect(fromDate.retryAfterSeconds).toBeGreaterThan(55);
    expect(fromDate.retryAfterSeconds).toBeLessThanOrEqual(60);
    await expect(sdk.contacts.get('c1')).rejects.toMatchObject({
      retryAfterSeconds: undefined,
    });
  });
});

describe('retried bodies', () => {
  it('sends the same bytes and key on each attempt, even if the caller changes the body', async () => {
    const body = {
      to: { email: 'a@example.test' },
      email: { subject: 'Receipt', html: '<p>Thanks</p>', from: 'shop@example.test' },
    };
    const sent: { body: string; key: string }[] = [];
    const fetch = ((_input: URL, init: RequestInit = {}) => {
      sent.push({
        body: init.body as string,
        key: header({ url: '', init }, 'idempotency-key')!,
      });
      body.to.email = 'changed@example.test';
      return Promise.resolve(
        sent.length === 1
          ? serverError()
          : json({ data: { messages: [] } }, { status: 202 }),
      );
    }) as typeof globalThis.fetch;

    await kirora(fetch, { retry: { maxRetries: 1, maxDelayMs: 0 } }).transactional.send(
      body,
    );

    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(JSON.parse(sent[0]!.body).to.email).toBe('a@example.test');
  });

  it('keeps the generated per-entry keys of a batch across retries', async () => {
    const { kirora, calls } = client([serverError(), json({ data: { results: [] } })]);
    const event = { externalId: 'u1', name: 'Order Completed' };

    await kirora.events.trackBatch({ events: [{ event }, { event }] });

    expect(calls).toHaveLength(2);
    expect(calls[1]!.init.body).toBe(calls[0]!.init.body);
  });
});

describe('configuration', () => {
  it.each([
    ['timeoutMs', { timeoutMs: 0 }],
    ['timeoutMs', { timeoutMs: -1 }],
    ['timeoutMs', { timeoutMs: 1.5 }],
    ['timeoutMs', { timeoutMs: Number.NaN }],
    ['timeoutMs', { timeoutMs: Number.POSITIVE_INFINITY }],
    ['retry.maxRetries', { retry: { maxRetries: -1 } }],
    ['retry.maxRetries', { retry: { maxRetries: 1.5 } }],
    ['retry.maxRetries', { retry: { maxRetries: Number.POSITIVE_INFINITY } }],
    ['retry.maxRetries', { retry: { maxRetries: 11 } }],
    ['retry.maxDelayMs', { retry: { maxDelayMs: -1 } }],
    ['retry.maxDelayMs', { retry: { maxDelayMs: Number.NaN } }],
    ['retry.maxDelayMs', { retry: { maxDelayMs: 2 ** 31 } }],
  ] as const)('rejects an invalid %s: %o', (name, options) => {
    expect(() => new KiroraClient({ apiKey: 'kirora_test', ...options })).toThrow(
      new RegExp(`^${name.replace('.', '\\.')} must be`),
    );
  });

  it('accepts the boundary values', () => {
    expect(
      () =>
        new KiroraClient({
          apiKey: 'kirora_test',
          timeoutMs: 1,
          retry: { maxRetries: 0, maxDelayMs: 0 },
        }),
    ).not.toThrow();
    expect(
      () =>
        new KiroraClient({
          apiKey: 'kirora_test',
          timeoutMs: 2 ** 31 - 1,
          retry: { maxRetries: 10, maxDelayMs: 2 ** 31 - 1 },
        }),
    ).not.toThrow();
  });
});

describe('retries', () => {
  it('retries a 429 and succeeds, honouring the response', async () => {
    const { kirora, calls } = client([rateLimited('0'), json({ data: { id: 'c1' } })]);

    await expect(kirora.contacts.get('c1')).resolves.toEqual({ id: 'c1' });
    expect(calls).toHaveLength(2);
  });

  it('never retries before Retry-After; a longer wait goes to the caller', async () => {
    const { kirora, calls } = client([rateLimited('60')]);

    await expect(kirora.contacts.get('c1')).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
    });
    expect(calls).toHaveLength(1);
  });

  it('does not retry a 4xx that will fail identically', async () => {
    const { kirora, calls } = client([
      json({ error: { code: 'VALIDATION_ERROR', message: 'bad' } }, { status: 400 }),
    ]);

    await expect(kirora.contacts.get('c1')).rejects.toBeInstanceOf(KiroraError);
    expect(calls).toHaveLength(1);
  });

  it('gives up after the configured number of attempts', async () => {
    const { kirora, calls } = client([serverError(), serverError(), serverError()]);

    await expect(kirora.contacts.get('c1')).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(3); // the first attempt plus maxRetries: 2
  });

  it('never repeats a write without a key that may have happened, but does after a 429', async () => {
    const create = (kirora: Kirora) =>
      kirora.client.request('POST', '/v1/notes', { body: { text: 'hi' } });
    const failed = client([serverError(), serverError()]);
    // The 500 might have come after the note was created, so don't retry.
    await expect(create(failed.kirora)).rejects.toMatchObject({ status: 500 });
    expect(failed.calls).toHaveLength(1);

    // A 429 means nothing happened, so retrying is safe.
    const limited = client([rateLimited('0'), json({ id: 'n1' })]);
    await expect(create(limited.kirora)).resolves.toMatchObject({ id: 'n1' });
    expect(limited.calls).toHaveLength(2);
  });
});

describe('per-call overrides', () => {
  it('uses a call’s own timeoutMs and maxRetries', async () => {
    const calls = { count: 0 };
    const sdk = kirora(hangingFetch(calls), { timeoutMs: 10_000 });

    await expect(
      sdk.contacts.get('c1', {}, { timeoutMs: 20, maxRetries: 0 }),
    ).rejects.toBeInstanceOf(KiroraTimeoutError);
    expect(calls.count).toBe(1);
  });

  it('rejects an invalid override before sending', async () => {
    const { fetch, calls } = stubFetch([]);

    await expect(
      kirora(fetch).contacts.get('c1', {}, { maxRetries: -1 }),
    ).rejects.toThrow(/^maxRetries must be/);
    await expect(kirora(fetch).contacts.get('c1', {}, { timeoutMs: 0 })).rejects.toThrow(
      /^timeoutMs must be/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('response metadata', () => {
  it('leaves a payload’s own lastResponse alone', async () => {
    const { kirora } = client([json({ lastResponse: 'mine', id: 'x' })]);

    const result = await kirora.client.request<Record<string, unknown>>('GET', '/v1/x');

    expect(result.lastResponse).toBe('mine');
    expect(Object.keys(result)).toEqual(['lastResponse', 'id']);
  });

  it('attaches the response as a non-enumerable lastResponse', async () => {
    const { kirora } = client([
      json(
        { data: { id: 'c1' } },
        {
          status: 201,
          headers: { 'x-request-id': 'req_1', 'idempotency-replay': 'true' },
        },
      ),
    ]);

    const contact = await kirora.contacts.identify({ externalId: 'u1' });

    expect(contact.lastResponse).toMatchObject({
      status: 201,
      requestId: 'req_1',
      idempotencyReplay: true,
    });
    expect(contact.lastResponse.headers.get('x-request-id')).toBe('req_1');
    expect(Object.keys(contact)).toEqual(['id']);
    expect(JSON.stringify(contact)).toBe('{"id":"c1"}');
  });
});

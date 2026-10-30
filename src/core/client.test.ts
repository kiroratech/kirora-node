import { getEventListeners } from 'node:events';
import { ReadableStream } from 'node:stream/web';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Kirora,
  KiroraClient,
  KiroraConnectionError,
  KiroraError,
  KiroraResponseError,
  KiroraTimeoutError,
  type ClientOptions,
} from '../index.js';
import { VERSION } from './version.js';
import {
  client,
  header,
  json,
  noContent,
  rateLimited,
  serverError,
  stubFetch,
  UUID,
  generated,
  entryKeys,
} from '../../test/helpers.js';

const kirora = (fetch: typeof globalThis.fetch, options: Partial<ClientOptions> = {}) =>
  client([], { fetch, ...options }).kirora;

function brokenBody(status = 200): Response {
  const body = new ReadableStream({
    pull(controller) {
      controller.error(new Error('socket closed'));
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

/** A fetch whose response body stays open until the request's signal aborts it. */
function openBodyFetch(onStart?: (controller: ReadableStreamDefaultController) => void) {
  return ((_input: URL, init: RequestInit = {}) => {
    const body = new ReadableStream({
      start(controller) {
        onStart?.(controller);
        init.signal!.addEventListener('abort', () =>
          controller.error(init.signal!.reason),
        );
      },
    });
    return Promise.resolve(new Response(body));
  }) as typeof globalThis.fetch;
}

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
    const fetch = openBodyFetch();
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

describe('headers', () => {
  it('names the SDK, its version and the runtime in the User-Agent', async () => {
    const { kirora, calls } = client([json({ data: {} })]);
    await kirora.contacts.get('c1');
    expect(header(calls[0]!, 'user-agent')).toBe(
      `kirora-node/${VERSION} node/${process.version}`,
    );
  });

  it('adds the app named by appInfo, which forWorkspace keeps', async () => {
    const sdk = `kirora-node/${VERSION} node/${process.version}`;
    const appInfo = { name: 'acme-sync', version: '2.1.0' };
    const { kirora, calls } = client([json({ data: {} }), json({ data: {} })], {
      appInfo,
    });
    appInfo.name = 'changed later';
    await kirora.contacts.get('c1');
    await kirora.forWorkspace('tenant-1').contacts.get('c1');
    expect(calls.map((call) => header(call, 'user-agent'))).toEqual([
      `${sdk} acme-sync/2.1.0`,
      `${sdk} acme-sync/2.1.0`,
    ]);

    const nameOnly = client([json({ data: {} })], { appInfo: { name: 'acme' } });
    await nameOnly.kirora.contacts.get('c1');
    expect(header(nameOnly.calls[0]!, 'user-agent')).toBe(`${sdk} acme`);
  });

  it.each([
    ['appInfo.name', { name: '' }],
    ['appInfo.name', { name: 'acme sync' }],
    ['appInfo.name', { name: 'acme+sync' }],
    ['appInfo.version', { name: 'acme', version: '1/2' }],
    ['appInfo.version', { name: 'acme', version: '1\r\nx-evil: 1' }],
  ])('rejects an invalid %s: %o', (name, appInfo) => {
    expect(() => new KiroraClient({ apiKey: 'kirora_test', appInfo })).toThrow(
      new RegExp(`^${name.replace('.', '\\.')} must be`),
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
      code: 'BAD_REQUEST',
      message: 'HTTP 400',
      errors: [],
    });
    await expect(kirora.lists.create({ name: 'x' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
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
    expect(calls).toHaveLength(3);
  });

  it('never repeats a write without a key that may have happened, but does after a 429', async () => {
    const create = (kirora: Kirora) =>
      kirora.client.request('POST', '/v1/notes', { body: { text: 'hi' } });
    const failed = client([serverError(), serverError()]);
    await expect(create(failed.kirora)).rejects.toMatchObject({ status: 500 });
    expect(failed.calls).toHaveLength(1);

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

describe('retries by the spec', () => {
  const raw = (kirora: Kirora, method: string, path: string, options = {}) =>
    kirora.client.request(method, path, options);

  it('retries a raw request as its endpoint allows', async () => {
    const patch = client([serverError(), json({ data: {} })]);
    await raw(patch.kirora, 'PATCH', '/v1/lists/l1', { body: { name: 'x' } });
    expect(patch.calls).toHaveLength(2);

    const preview = client([serverError(), json({ data: {} })]);
    await raw(preview.kirora, 'POST', '/v1/campaigns/c1/preview', { body: {} });
    expect(preview.calls).toHaveLength(2);
  });

  it('keys a raw request and each entry of a raw batch, once for every attempt', async () => {
    const { kirora, calls } = client([
      serverError(),
      json({ data: {} }),
      json({ data: {} }),
    ]);
    await raw(kirora, 'POST', '/v1/events/batch', {
      body: { events: [{ name: 'a' }, { name: 'b', idempotencyKey: 'k' }] },
    });
    await raw(kirora, 'POST', '/v1/lists', { body: { name: 'x' } });

    expect(entryKeys(calls[0]!, 'events')).toEqual([generated, 'k']);
    expect(entryKeys(calls[1]!, 'events')).toEqual(entryKeys(calls[0]!, 'events'));
    expect(header(calls[0]!, 'idempotency-key')).toBeNull();
    expect(header(calls[2]!, 'idempotency-key')).toMatch(UUID);
  });

  it('retries an endpoint newer than the SDK only by method or with a key', async () => {
    const unkeyed = client([serverError()]);
    await expect(raw(unkeyed.kirora, 'POST', '/v1/notes')).rejects.toMatchObject({
      status: 500,
    });
    expect(unkeyed.calls).toHaveLength(1);

    const keyed = client([serverError(), json({})]);
    await raw(keyed.kirora, 'POST', '/v1/notes', { headers: { 'Idempotency-Key': 'k' } });
    expect(keyed.calls.map((call) => header(call, 'idempotency-key'))).toEqual([
      'k',
      'k',
    ]);

    const put = client([serverError(), json({})]);
    await raw(put.kirora, 'PUT', '/v1/notes/n1');
    expect(put.calls).toHaveLength(2);
  });

  it('retries IDEMPOTENCY_KEY_IN_USE, which the earlier request will answer', async () => {
    const { kirora, calls } = client([
      json(
        { error: { code: 'IDEMPOTENCY_KEY_IN_USE', message: 'busy' } },
        { status: 409 },
      ),
      json({ data: { id: 'l1' } }),
    ]);

    await kirora.lists.create({ name: 'x' });
    expect(calls).toHaveLength(2);
  });

  it('retries any request whose connection was never made', async () => {
    let attempts = 0;
    const fetch = (() => {
      attempts++;
      if (attempts === 1) {
        const cause = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
        return Promise.reject(new TypeError('fetch failed', { cause }));
      }
      return Promise.resolve(json({}));
    }) as typeof globalThis.fetch;

    await raw(kirora(fetch), 'POST', '/v1/notes');
    expect(attempts).toBe(2);
  });

  it('counts a 404 on a retried delete as done, once an attempt may have deleted it', async () => {
    const notFound = () =>
      json({ error: { code: 'NOT_FOUND', message: 'gone' } }, { status: 404 });
    const done = client([serverError(), notFound()]);
    await expect(done.kirora.lists.delete('l1')).resolves.toBeUndefined();

    const limited = client([rateLimited('0'), notFound()]);
    await expect(limited.kirora.lists.delete('l1')).rejects.toMatchObject({
      status: 404,
    });

    const first = client([notFound()]);
    await expect(first.kirora.lists.delete('l1')).rejects.toMatchObject({ status: 404 });

    // A load balancer's 503, without the API's request id, never reached the API.
    const balancer = client([new Response('', { status: 503 }), notFound()]);
    await expect(balancer.kirora.lists.delete('l1')).rejects.toMatchObject({
      status: 404,
    });

    const api = client([
      json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'm' } },
        {
          status: 503,
          headers: { 'x-request-id': 'req_1' },
        },
      ),
      notFound(),
    ]);
    await expect(api.kirora.lists.delete('l1')).resolves.toBeUndefined();
  });

  it('rejects with the API’s answer when it arrived as the signal aborted', async () => {
    const controller = new AbortController();
    const fetch = (() => {
      controller.abort(new Error('caller gave up'));
      return Promise.resolve(serverError());
    }) as typeof globalThis.fetch;

    await expect(
      kirora(fetch).contacts.get('c1', {}, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(KiroraError);
  });
});

describe('error codes', () => {
  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [405, 'METHOD_NOT_ALLOWED'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [422, 'BAD_REQUEST'],
    [502, 'INTERNAL_ERROR'],
  ])('picks a code by status %i when the body has none', async (status, code) => {
    const { kirora } = client([new Response('', { status })], {
      retry: { maxRetries: 0 },
    });
    await expect(kirora.contacts.get('c1')).rejects.toMatchObject({ code, status });
  });

  it('falls back from an empty code or message', async () => {
    const { kirora } = client([
      json({ error: { code: '', message: '' } }, { status: 403 }),
    ]);
    await expect(kirora.contacts.get('c1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'HTTP 403',
    });
  });
});

describe('responses', () => {
  const limits = {
    'ratelimit-limit': '100',
    'ratelimit-remaining': '7',
    'ratelimit-reset': '30',
  };

  it('reads the rate limit headers onto the response and the error', async () => {
    const { kirora } = client([
      json({ data: {} }, { headers: limits }),
      json({ error: { code: 'X', message: 'x' } }, { status: 400, headers: limits }),
      json({ data: {} }, { headers: { ...limits, 'ratelimit-reset': '-1' } }),
    ]);
    const expected = { limit: 100, remaining: 7, resetSeconds: 30 };

    expect((await kirora.contacts.get('c1')).lastResponse.rateLimit).toEqual(expected);
    await expect(kirora.contacts.get('c1')).rejects.toMatchObject({
      rateLimit: expected,
    });
    expect((await kirora.contacts.get('c1')).lastResponse.rateLimit).toBeUndefined();
  });

  it('refuses a body larger than 64 MiB without reading it all', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulled = 0;
    const endless = new ReadableStream({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const { kirora } = client([
      new Response(null, { headers: { 'content-length': String(2 ** 27) } }),
      new Response(endless),
    ]);

    await expect(kirora.contacts.get('c1')).rejects.toThrow(/larger than 64 MiB/);
    await expect(kirora.contacts.get('c1')).rejects.toBeInstanceOf(KiroraResponseError);
    expect(pulled).toBeLessThan(70);
  });

  it('keeps the status of an error whose body is too large, so a 503 is retried', async () => {
    const { kirora, calls } = client([
      new Response(null, { status: 503, headers: { 'content-length': String(2 ** 27) } }),
      json({ data: { id: 'c1' } }),
    ]);

    await expect(kirora.contacts.get('c1')).resolves.toEqual({ id: 'c1' });
    expect(calls).toHaveLength(2);
  });

  it('reads a body that starts with a byte order mark', async () => {
    const bom = (body: unknown, status = 200) =>
      new Response(`\uFEFF${JSON.stringify(body)}`, { status });
    const { kirora } = client([
      bom({ data: { id: 'c1' } }),
      bom({ error: { code: 'VALIDATION_ERROR', message: 'bad' } }, 400),
    ]);

    await expect(kirora.contacts.get('c1')).resolves.toEqual({ id: 'c1' });
    await expect(kirora.contacts.get('c1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('reads Retry-After in the obsolete RFC 850 and asctime date forms', async () => {
    const at = new Date(Math.floor(Date.now() / 1_000) * 1_000 + 30 * 86_400_000);
    // toUTCString() gives the IMF-fixdate, such as "Wed, 06 Nov 2030 08:49:37 GMT".
    const [day, date, month, year, time] = at.toUTCString().split(' ');
    const weekday = new Intl.DateTimeFormat('en', {
      weekday: 'long',
      timeZone: 'UTC',
    }).format(at);
    const rfc850 = `${weekday}, ${date}-${month}-${year!.slice(2)} ${time} GMT`;
    const asctime = `${day!.slice(0, 3)} ${month} ${date!.replace(/^0/, ' ')} ${time} ${year}`;

    for (const header of [rfc850, asctime]) {
      const { kirora } = client([rateLimited(header)], { retry: { maxRetries: 0 } });
      const error = (await kirora.contacts
        .get('c1')
        .catch((e: unknown) => e)) as KiroraError;
      expect(error.retryAfterSeconds).toBeCloseTo(
        (at.getTime() - Date.now()) / 1_000,
        -1,
      );
    }
  });

  it('refuses a body over 64 MiB without waiting on a copy the caller kept', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const endless = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    const fetch = (() => {
      const response = new Response(endless);
      response.clone(); // Left unread, as a caller keeping a copy would.
      return Promise.resolve(response);
    }) as typeof globalThis.fetch;

    await expect(
      kirora(fetch, { retry: { maxRetries: 0 } }).client.request('GET', '/v1/x'),
    ).rejects.toThrow(/larger than 64 MiB/);
  });

  it('resolves with the unread response from requestRaw(), after retrying an error', async () => {
    const { kirora, calls } = client([
      serverError(),
      new Response('id,email\n1,a@example.test\n', {
        headers: { 'content-type': 'text/csv' },
      }),
    ]);

    const response = await kirora.client.requestRaw('GET', '/v1/contacts/export');
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe('id,email\n1,a@example.test\n');
    expect(calls).toHaveLength(2);

    const failed = client([
      json({ error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 }),
    ]);
    await expect(failed.kirora.client.requestRaw('GET', '/v1/x')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('leaves no listener on a signal reused across calls', async () => {
    const { kirora } = client(Array.from({ length: 20 }, () => new Response('x')));
    const { signal } = new AbortController();

    for (let i = 0; i < 20; i++) {
      await (await kirora.client.requestRaw('GET', '/v1/x', { signal })).text();
    }
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  });

  it('leaves the body of requestRaw() to signal, not timeoutMs', async () => {
    let send: ReadableStreamDefaultController | undefined;
    const fetch = openBodyFetch((controller) => (send = controller));
    const controller = new AbortController();

    const response = await kirora(fetch, { timeoutMs: 5 }).client.requestRaw(
      'GET',
      '/v1/x',
      {
        signal: controller.signal,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    send!.enqueue(new TextEncoder().encode('still open'));
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const { value } = (await reader.read()) as { value: Uint8Array };
    expect(new TextDecoder().decode(value)).toBe('still open');

    controller.abort(new Error('stop'));
    await expect(reader.read()).rejects.toThrow('stop');
  });

  it('resolves a raw request with an empty success body as undefined', async () => {
    const { kirora } = client([new Response('', { status: 200 })]);
    await expect(kirora.client.request('POST', '/v1/notes')).resolves.toBeUndefined();
  });

  it('ignores a Retry-After date that isn’t an HTTP date', async () => {
    const { kirora } = client([rateLimited('2030-01-01T00:00:00Z')], {
      retry: { maxRetries: 0 },
    });
    await expect(kirora.contacts.get('c1')).rejects.toMatchObject({
      retryAfterSeconds: undefined,
    });
  });
});

describe('client options', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses a path that doesn’t start with "/"', async () => {
    const { kirora, calls } = client();
    await expect(kirora.client.request('GET', 'v1/me')).rejects.toThrow(
      /must start with "\/"/,
    );
    expect(calls).toHaveLength(0);
  });

  it('reads an empty API key from the environment, and trims quotes', async () => {
    vi.stubEnv('KIRORA_API_KEY', ' "kirora_env" ');
    const { fetch, calls } = stubFetch([json({ data: {} })]);
    await new Kirora({ apiKey: '', fetch }).client.requestData('GET', '/v1/me');
    expect(header(calls[0]!, 'authorization')).toBe('Bearer kirora_env');
  });

  it('reads the base URL from the environment, and checks it when created', async () => {
    vi.stubEnv('KIRORA_BASE_URL', 'https://env.example.test/');
    const { fetch, calls } = stubFetch([json({ data: {} })]);
    await new Kirora({ apiKey: 'k', fetch }).client.requestData('GET', '/v1/me');
    expect(calls[0]!.url).toBe('https://env.example.test/v1/me');

    for (const baseUrl of ['api.kirora.io', '/v1', '']) {
      expect(() => new KiroraClient({ apiKey: 'k', baseUrl })).toThrow(TypeError);
    }
  });

  it('refuses an empty workspace, which would act in the key’s own', async () => {
    const { kirora, calls } = client();
    expect(() => new KiroraClient({ apiKey: 'k', workspace: '' })).toThrow(TypeError);
    expect(() => kirora.forWorkspace('')).toThrow(TypeError);
    await expect(kirora.contacts.get('c1', {}, { workspace: '' })).rejects.toThrow(
      TypeError,
    );
    expect(calls).toHaveLength(0);
  });

  it('treats a Kirora-Workspace header as the workspace option', async () => {
    expect(
      () => new KiroraClient({ apiKey: 'k', headers: { 'Kirora-Workspace': '' } }),
    ).toThrow(TypeError);

    const { kirora, calls } = client([json({ data: {} }), json({ data: {} })], {
      headers: { 'Kirora-Workspace': 'tenant-1' },
    });
    await kirora.contacts.get('c1');
    await kirora.forWorkspace('tenant-2').contacts.get('c1');
    expect(calls.map((call) => header(call, 'kirora-workspace'))).toEqual([
      'tenant-1',
      'tenant-2',
    ]);

    await expect(
      kirora.contacts.get('c1', {}, { headers: { 'kirora-workspace': '' } }),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(2);
  });

  it('refuses an empty idempotency key, as an option or a header', async () => {
    const { kirora, calls } = client();
    await expect(
      kirora.lists.create({ name: 'x' }, { idempotencyKey: '' }),
    ).rejects.toThrow(TypeError);
    await expect(
      kirora.lists.create({ name: 'x' }, { headers: { 'Idempotency-Key': '' } }),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it('refuses an Idempotency-Key for every call', () => {
    expect(
      () => new KiroraClient({ apiKey: 'k', headers: { 'Idempotency-Key': 'x' } }),
    ).toThrow(TypeError);
  });

  it('keeps the base URL it was created with in forWorkspace()', async () => {
    vi.stubEnv('KIRORA_BASE_URL', 'https://first.example.test');
    const { fetch, calls } = stubFetch([json({ data: {} })]);
    const parent = new Kirora({ apiKey: 'k', fetch });
    vi.stubEnv('KIRORA_BASE_URL', 'https://second.example.test');

    await parent.forWorkspace('t1').client.requestData('GET', '/v1/me');
    expect(calls[0]!.url).toBe('https://first.example.test/v1/me');
  });

  it('sends the client’s and the call’s headers, under the SDK’s own', async () => {
    const { kirora, calls } = client([json({ data: {} })], {
      headers: { 'X-Trace': 'client', 'X-Team': 'growth', Authorization: 'nope' },
    });
    await kirora.contacts.get('c1', {}, { headers: { 'x-trace': 'call' } });

    expect(header(calls[0]!, 'x-trace')).toBe('call');
    expect(header(calls[0]!, 'x-team')).toBe('growth');
    expect(header(calls[0]!, 'authorization')).toBe('Bearer kirora_test');
  });
});

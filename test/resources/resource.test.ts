import { describe, it, expect } from 'vitest';
import type { Kirora } from '../../src/index.js';
import { client, header, json, page } from '../helpers.js';

/**
 * Whether the signal passed to `call` reaches fetch: aborts it during the `nth` fetch,
 * then reports whether the signal fetch got was aborted too. Every page but the last
 * points at a next one.
 */
async function abortsFetch(
  call: (kirora: Kirora, signal: AbortSignal) => Promise<unknown>,
  nth = 1,
): Promise<boolean> {
  const controller = new AbortController();
  let count = 0;
  let aborted = false;
  const fetch = ((_input: URL, init: RequestInit = {}) => {
    if (++count === nth) {
      controller.abort();
      aborted = init.signal!.aborted;
    }
    return Promise.resolve(page([], count < nth ? 'CUR' : null));
  }) as typeof globalThis.fetch;
  await call(client([], { fetch }).kirora, controller.signal).catch(() => {});
  return aborted;
}

describe('call options', () => {
  it('passes the signal to fetch from every resource family', async () => {
    const calls: ((kirora: Kirora, signal: AbortSignal) => Promise<unknown>)[] = [
      (kirora, signal) => kirora.lists.list({}, { signal }),
      (kirora, signal) => kirora.contacts.identify({ externalId: 'u1' }, { signal }),
      (kirora, signal) => kirora.campaigns.eligibility('k1', { signal }),
      (kirora, signal) =>
        kirora.transactional.send(
          { to: { email: 'a@example.test' }, email: { template: 'receipt' } },
          { signal },
        ),
      (kirora, signal) =>
        kirora.events.track({ externalId: 'u1', name: 'Signed Up' }, { signal }),
    ];

    for (const call of calls) {
      expect(await abortsFetch(call)).toBe(true);
    }
  });

  it('forwards the signal to every page of a list', async () => {
    // Aborts during the second page's fetch, so it must have that page's signal.
    expect(
      await abortsFetch(async (kirora, signal) => {
        for await (const _ of kirora.lists.list({}, { signal })) {
          // Drain.
        }
      }, 2),
    ).toBe(true);
  });

  it('overrides the workspace for one call only', async () => {
    const { kirora, calls } = client([json({ data: {} }), json({ data: {} })]);

    await kirora.lists.get('l1', { workspace: 'tenant-1' });
    await kirora.lists.get('l1');
    expect(header(calls[0]!, 'kirora-workspace')).toBe('tenant-1');
    expect(header(calls[1]!, 'kirora-workspace')).toBeNull();
  });

  it('passes only the controls to the transport', async () => {
    const { kirora, calls } = client([json({ data: {} })]);
    // A JavaScript caller could pass anything here.
    const options = { body: { injected: true }, idempotencyKey: 'x' } as object;

    await kirora.lists.get('l1', options);

    expect(calls[0]!.init.body).toBeUndefined();
    expect(header(calls[0]!, 'idempotency-key')).toBeNull();
  });
});

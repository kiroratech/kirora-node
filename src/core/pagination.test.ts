import { describe, it, expect } from 'vitest';
import { KiroraResponseError } from '../index.js';
import { client, header, json, page } from '../../test/helpers.js';

describe('PagePromise', () => {
  it('walks pages and stops on a null cursor, not on an empty page', async () => {
    const { kirora, calls } = client([
      page([{ id: 1 }, { id: 2 }], 'CUR1'),
      page([], 'CUR2'),
      page([{ id: 3 }], null),
    ]);

    const seen = [];
    for await (const contact of kirora.contacts.list({ limit: 2 })) {
      seen.push(contact);
    }

    expect(seen).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).not.toContain('cursor=');
    expect(calls[1]!.url).toContain('cursor=CUR1');
    expect(calls[2]!.url).toContain('cursor=CUR2');
  });

  it('resolves with the first page when awaited, with the cursor left to the caller', async () => {
    const { kirora, calls } = client([page([{ id: 1 }], 'CUR')]);

    const first = await kirora.contacts.list({ limit: 1 });

    expect(first.data).toEqual([{ id: 1 }]);
    expect(first.meta.pagination.nextCursor).toBe('CUR');
    expect(first.lastResponse.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('starts from a given cursor', async () => {
    const { kirora, calls } = client([page([], null)]);

    await kirora.lists.list({ cursor: 'CUR' });

    expect(calls[0]!.url).toBe('https://api.example.test/v1/lists?cursor=CUR');
  });

  it('fetches nothing until awaited or iterated, and reuses the first page', async () => {
    const { kirora, calls } = client([page([{ id: 1 }], 'CUR'), page([{ id: 2 }], null)]);

    const list = kirora.campaigns.list();
    expect(calls).toHaveLength(0);

    const first = await list;
    const seen = [];
    for await (const campaign of list) {
      seen.push(campaign);
    }

    expect(first.data).toEqual([{ id: 1 }]);
    expect(seen).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls).toHaveLength(2);
  });

  it('keeps the filters and options it was given, however the caller changes them', async () => {
    const { kirora, calls } = client([page([{ id: 1 }], 'C'), page([{ id: 2 }], null)]);
    const query: { query: string; limit?: number } = { query: 'first' };
    const options: { workspace: string } = { workspace: 'tenant-1' };

    const list = kirora.contacts.list(query, options);
    await list;
    query.query = 'changed';
    query.limit = 5;
    options.workspace = 'tenant-2';
    for await (const _ of list) {
      // Drain.
    }

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.example.test/v1/contacts?query=first',
      'https://api.example.test/v1/contacts?query=first&cursor=C',
    ]);
    expect(header(calls[1]!, 'kirora-workspace')).toBe('tenant-1');
  });

  it('stops before the next item once aborted, even within a fetched page', async () => {
    const reason = new Error('stop');
    let controller = new AbortController();
    let seen: unknown[] = [];
    const drain = async (list: AsyncIterable<unknown>, abortAfter: number) => {
      seen = [];
      for await (const item of list) {
        seen.push(item);
        if (seen.length === abortAfter) controller.abort(reason);
      }
    };

    const last = client([page([{ id: 1 }, { id: 2 }])]);
    await expect(
      drain(last.kirora.contacts.list({}, { signal: controller.signal }), 1),
    ).rejects.toBe(reason);
    expect(seen).toEqual([{ id: 1 }]);

    controller = new AbortController();
    const between = client([page([{ id: 1 }], 'C'), page([{ id: 2 }])]);
    await expect(
      drain(between.kirora.contacts.list({}, { signal: controller.signal }), 1),
    ).rejects.toBe(reason);
    expect(seen).toEqual([{ id: 1 }]);
    expect(between.calls).toHaveLength(1);

    controller = new AbortController();
    const awaited = client([page([{ id: 1 }])]);
    const list = awaited.kirora.contacts.list({}, { signal: controller.signal });
    await list;
    controller.abort(reason);
    await expect(drain(list, 0)).rejects.toBe(reason);
    expect(seen).toEqual([]);
  });

  it('stops rather than loop on a cursor that repeats', async () => {
    const { kirora, calls } = client([page([{ id: 1 }], 'C'), page([{ id: 1 }], 'C')]);

    const iterate = async () => {
      for await (const _ of kirora.contacts.list()) {
        // Drain.
      }
    };

    await expect(iterate()).rejects.toBeInstanceOf(KiroraResponseError);
    expect(calls).toHaveLength(2);
  });

  it('stops on a cursor that comes round again, but follows empty pages that progress', async () => {
    const cycle = client([
      page([1], 'A'),
      page([2], 'B'),
      page([3], 'C'),
      page([4], 'A'),
    ]);
    const iterate = async () => {
      for await (const _ of cycle.kirora.contacts.list()) {
        // Drain.
      }
    };
    await expect(iterate()).rejects.toBeInstanceOf(KiroraResponseError);
    expect(cycle.calls).toHaveLength(4);

    const progressing = client([page([], 'A'), page([], 'B'), page([1], null)]);
    const seen = [];
    for await (const item of progressing.kirora.contacts.list()) seen.push(item);
    expect(seen).toEqual([1]);
  });

  it('works with promise methods', async () => {
    const { kirora } = client([
      json({ error: { code: 'NOT_FOUND', message: 'gone' } }, { status: 404 }),
    ]);
    let settled = false;

    const code = await kirora.lists
      .list()
      .catch((error: unknown) => (error as { code: string }).code)
      .finally(() => (settled = true));

    expect(code).toBe('NOT_FOUND');
    expect(settled).toBe(true);
  });
});

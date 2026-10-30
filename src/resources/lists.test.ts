import { describe, it, expect } from 'vitest';
import {
  UUID,
  generated,
  client,
  header,
  json,
  noContent,
  sent,
  serverError,
} from '../../test/helpers.js';

describe('lists', () => {
  it('deletes a list, resolving with undefined on a 204', async () => {
    const { kirora, calls } = client([noContent()]);

    await expect(kirora.lists.delete('l1')).resolves.toBeUndefined();
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.url).toBe('https://api.example.test/v1/lists/l1');
  });

  it('adds contacts, retrying since existing members are skipped', async () => {
    const { kirora, calls } = client([serverError(), json({ data: { added: 1 } })]);

    await kirora.lists.addContacts('l1', { contactIds: ['c1'] });

    expect(calls).toHaveLength(2);
    expect(sent(calls[1]!).body).toEqual({ contactIds: ['c1'] });
  });

  it('creates a list with a key, kept across retries', async () => {
    const generated = client([
      serverError(),
      json({ data: { id: 'l1' } }, { status: 201 }),
    ]);
    await generated.kirora.lists.create({ name: 'VIPs' });
    const [first, second] = generated.calls.map((call) =>
      header(call, 'idempotency-key'),
    );
    expect(first).toMatch(UUID);
    expect(second).toBe(first);

    const own = client([serverError(), json({ data: { id: 'l1' } }, { status: 201 })]);
    await own.kirora.lists.create({ name: 'VIPs' }, { idempotencyKey: 'vips' });
    expect(own.calls.map((call) => header(call, 'idempotency-key'))).toEqual([
      'vips',
      'vips',
    ]);
  });

  it('sends a key for adding contacts, its own if given one', async () => {
    const { kirora, calls } = client([json({ data: {} }), json({ data: {} })]);

    await kirora.lists.addContacts('l1', { contactIds: ['c1'] });
    await kirora.lists.addContacts('l1', { contactIds: ['c1'] }, { idempotencyKey: 'k' });

    expect(header(calls[0]!, 'idempotency-key')).toMatch(UUID);
    expect(header(calls[1]!, 'idempotency-key')).toBe('k');
  });

  it('updates a list and removes contacts from it', async () => {
    const { kirora, calls } = client([
      json({ data: { id: 'l1' } }),
      json({ data: { removed: 1 } }),
    ]);

    await kirora.lists.update('l1', { name: 'VIPs' });
    await kirora.lists.deleteContacts('l1', { emails: ['a@example.test'] });

    expect(calls.map(sent)).toEqual([
      { method: 'PATCH', path: '/v1/lists/l1', body: { name: 'VIPs' }, key: null },
      {
        method: 'POST',
        path: '/v1/lists/l1/contacts/delete',
        body: { emails: ['a@example.test'] },
        key: generated,
      },
    ]);
  });
});

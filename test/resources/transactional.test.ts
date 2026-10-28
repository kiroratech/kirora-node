import { describe, it, expect } from 'vitest';
import { UUID, client, entryKeys, generated, header, json, sent } from '../helpers.js';

describe('transactional', () => {
  it('passes an idempotency key through as a header, and makes one when none is given', async () => {
    const { kirora, calls } = client([
      json({ data: { id: 'm1' } }, { status: 202 }),
      json({ data: { id: 'm2' } }, { status: 202 }),
    ]);
    const body = {
      to: { email: 'a@example.test' },
      email: { subject: 'Receipt', html: '<p>Thanks</p>', from: 'shop@example.test' },
    };
    await kirora.transactional.send(body, { idempotencyKey: 'receipt-42' });
    await kirora.transactional.send(body);
    expect(header(calls[0]!, 'idempotency-key')).toBe('receipt-42');
    expect(header(calls[1]!, 'idempotency-key')).toMatch(UUID);
  });

  it('makes a key for each batch entry without one', async () => {
    const { kirora, calls } = client([json({ data: { results: [] } })]);
    const message = { to: { email: 'a@example.test' }, email: { template: 'receipt' } };

    await kirora.transactional.sendBatch({
      messages: [{ idempotencyKey: 'receipt-1', message }, { message }],
    });

    const [given, made] = entryKeys(calls[0]!, 'messages');
    expect(given).toBe('receipt-1');
    expect(made).toMatch(UUID);
  });

  it('cancels a scheduled message with a key made for the call', async () => {
    const { kirora, calls } = client([json({ data: { id: 'm1', status: 'cancelled' } })]);

    await kirora.transactional.cancel('m1');

    expect(calls.map(sent)).toEqual([
      {
        method: 'POST',
        path: '/v1/transactional/messages/m1/cancel',
        body: undefined,
        key: generated,
      },
    ]);
  });
});

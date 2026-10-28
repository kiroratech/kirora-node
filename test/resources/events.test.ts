import { describe, it, expect } from 'vitest';
import { UUID, client, entryKeys, header, json } from '../helpers.js';

describe('events', () => {
  it('makes a key for an event, and for each batch entry, when none is given', async () => {
    const { kirora, calls } = client([
      json({ data: { id: 'e1' } }, { status: 202 }),
      json({ data: { results: [] } }),
    ]);
    const event = { externalId: 'u1', name: 'Order Completed' };
    await kirora.events.track(event);
    await kirora.events.trackBatch({
      events: [{ idempotencyKey: 'order-1', event }, { event }],
    });

    expect(header(calls[0]!, 'idempotency-key')).toMatch(UUID);
    const [given, made] = entryKeys(calls[1]!, 'events');
    expect(given).toBe('order-1');
    expect(made).toMatch(UUID);
  });
});

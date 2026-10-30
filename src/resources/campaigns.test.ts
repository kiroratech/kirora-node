import { describe, it, expect } from 'vitest';
import { UUID, client, header, json } from '../../test/helpers.js';

describe('campaigns', () => {
  it('takes a trigger’s idempotency key as a trailing option, and makes one otherwise', async () => {
    const { kirora, calls } = client([
      json({ data: {} }, { status: 202 }),
      json({ data: {} }, { status: 202 }),
    ]);
    const body = { recipients: [{ externalId: 'u1' }] };

    await kirora.campaigns.trigger('k1', body, { idempotencyKey: 'trigger-1' });
    await kirora.campaigns.trigger('k1', body);
    expect(calls[0]!.url).toBe('https://api.example.test/v1/campaigns/k1/trigger');
    expect(header(calls[0]!, 'idempotency-key')).toBe('trigger-1');
    expect(header(calls[1]!, 'idempotency-key')).toMatch(UUID);
  });

  it('creates a campaign with a key, and forwards one to send and schedule', async () => {
    const { kirora, calls } = client([
      json({ data: {} }, { status: 201 }),
      json({ data: {} }, { status: 202 }),
      json({ data: {} }),
    ]);

    await kirora.campaigns.create({ name: 'Launch' });
    await kirora.campaigns.send('k1', { idempotencyKey: 'send-1' });
    await kirora.campaigns.schedule(
      'k1',
      { type: 'fixed', sendAt: '2026-11-02T09:00:00Z' },
      {
        idempotencyKey: 'schedule-1',
      },
    );

    expect(header(calls[0]!, 'idempotency-key')).toMatch(UUID);
    expect(header(calls[1]!, 'idempotency-key')).toBe('send-1');
    expect(header(calls[2]!, 'idempotency-key')).toBe('schedule-1');
  });
});

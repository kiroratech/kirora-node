import { describe, it, expect } from 'vitest';
import { client, json, page, sent } from '../../test/helpers.js';

describe('messages', () => {
  it('lists messages with filters and gets one', async () => {
    const { kirora, calls } = client([
      page([{ id: 'm1' }]),
      json({ data: { id: 'm1' } }),
    ]);

    const messages = await kirora.messages.list({
      status: 'bounced',
      correlationId: 'o-1',
    });
    const message = await kirora.messages.get('m1');

    expect(messages.data).toEqual([{ id: 'm1' }]);
    expect(message).toEqual({ id: 'm1' });
    expect(calls.map((call) => sent(call).path)).toEqual([
      '/v1/messages?status=bounced&correlationId=o-1',
      '/v1/messages/m1',
    ]);
  });
});

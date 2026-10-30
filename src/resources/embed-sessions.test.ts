import { describe, it, expect } from 'vitest';
import { client, generated, header, json, sent } from '../../test/helpers.js';

describe('embed sessions', () => {
  it('creates a session in a tenant, with a key made for the call', async () => {
    const { kirora, calls } = client([
      json({ data: { token: 'es_1' } }, { status: 201 }),
    ]);

    const session = await kirora
      .forWorkspace('acme')
      .embedSessions.create({ components: ['segment_builder'] });

    expect(session).toEqual({ token: 'es_1' });
    expect(header(calls[0]!, 'kirora-workspace')).toBe('acme');
    expect(sent(calls[0]!)).toEqual({
      method: 'POST',
      path: '/v1/embed-sessions',
      body: { components: ['segment_builder'] },
      key: generated,
    });
  });
});

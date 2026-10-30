import { describe, it, expect } from 'vitest';
import { client, generated, json, page, sent } from '../../test/helpers.js';

describe('workspaces', () => {
  it('sends each operation to its endpoint, making keys where a repeat would fail', async () => {
    const workspace = () => json({ data: { externalId: 'acme' } });
    const { kirora, calls } = client([
      page([{ externalId: 'acme' }]),
      json({ data: { externalId: 'acme' } }, { status: 201 }),
      workspace(),
      workspace(),
      workspace(),
      workspace(),
      workspace(),
      workspace(),
    ]);
    const create = { name: 'Acme', externalId: 'acme', country: 'GB' };

    await kirora.workspaces.list({ limit: 10 });
    await kirora.workspaces.create(create);
    await kirora.workspaces.get('acme');
    await kirora.workspaces.update('acme', { name: 'Acme Ltd' });
    const deleted = await kirora.workspaces.delete('acme');
    await kirora.workspaces.cancelDeletion('acme');
    await kirora.workspaces.suspend('acme', { idempotencyKey: 'suspend-1' });
    await kirora.workspaces.resume('acme');

    expect(deleted).toEqual({ externalId: 'acme' });
    expect(calls.map(sent)).toEqual([
      { method: 'GET', path: '/v1/workspaces?limit=10', body: undefined, key: null },
      { method: 'POST', path: '/v1/workspaces', body: create, key: generated },
      { method: 'GET', path: '/v1/workspaces/acme', body: undefined, key: null },
      {
        method: 'PATCH',
        path: '/v1/workspaces/acme',
        body: { name: 'Acme Ltd' },
        key: null,
      },
      { method: 'DELETE', path: '/v1/workspaces/acme', body: undefined, key: null },
      {
        method: 'POST',
        path: '/v1/workspaces/acme/cancel-deletion',
        body: undefined,
        key: generated,
      },
      {
        method: 'POST',
        path: '/v1/workspaces/acme/suspend',
        body: undefined,
        key: 'suspend-1',
      },
      {
        method: 'POST',
        path: '/v1/workspaces/acme/resume',
        body: undefined,
        key: generated,
      },
    ]);
  });
});

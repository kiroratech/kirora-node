import { describe, it, expect } from 'vitest';
import { client, generated, json, page, sent, serverError } from '../../test/helpers.js';

describe('suppressions', () => {
  it('lists, adds and deletes suppressed addresses', async () => {
    const { kirora, calls } = client([
      page([{ email: 'a@example.test' }]),
      json({ data: { added: 1 } }),
      json({ data: { deleted: 1 } }),
    ]);
    const emails = ['a@example.test'];

    await kirora.suppressions.list({ reason: 'bounced' });
    await kirora.suppressions.add({ emails }, { idempotencyKey: 'import-1' });
    await kirora.suppressions.delete({ emails });

    expect(calls.map(sent)).toEqual([
      {
        method: 'GET',
        path: '/v1/suppressions?reason=bounced',
        body: undefined,
        key: null,
      },
      { method: 'POST', path: '/v1/suppressions', body: { emails }, key: 'import-1' },
      {
        method: 'POST',
        path: '/v1/suppressions/delete',
        body: { emails },
        key: generated,
      },
    ]);
  });

  it('retries adding, since it is safe to repeat', async () => {
    const { kirora, calls } = client([serverError(), json({ data: { added: 1 } })]);

    await kirora.suppressions.add({ emails: ['a@example.test'] });

    expect(calls).toHaveLength(2);
  });
});

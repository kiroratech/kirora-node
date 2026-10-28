import { describe, it, expect, vi } from 'vitest';
import { Kirora } from '../src/index.js';
import { client, header, json, stubFetch } from './helpers.js';

describe('Kirora', () => {
  it('refuses to construct without an API key', () => {
    expect(() => new Kirora({ apiKey: '' })).toThrow('apiKey is required');
  });

  it('reads the API key from KIRORA_API_KEY when none is passed', async () => {
    const { fetch, calls } = stubFetch([json({ data: { id: 'c1' } })]);
    vi.stubEnv('KIRORA_API_KEY', 'kirora_from_env');
    try {
      await new Kirora({ fetch, baseUrl: 'https://api.example.test' }).contacts.get('c1');
      expect(header(calls[0]!, 'authorization')).toBe('Bearer kirora_from_env');

      vi.stubEnv('KIRORA_API_KEY', '');
      expect(() => new Kirora()).toThrow('set KIRORA_API_KEY');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reads the key in use', async () => {
    const { kirora, calls } = client([
      json({ data: { workspace: { id: 'w1', name: 'Acme' }, apiKey: { id: 'k1' } } }),
    ]);

    const me = await kirora.me();

    expect(me.workspace.name).toBe('Acme');
    expect(calls[0]!.url).toBe('https://api.example.test/v1/me');
  });

  it('acts in a partner tenant through the Kirora-Workspace header', async () => {
    const { kirora, calls } = client([json({ data: { id: 'c1' } })]);
    await kirora.forWorkspace('tenant-42').contacts.get('c1');
    expect(header(calls[0]!, 'kirora-workspace')).toBe('tenant-42');
  });

  it('is not affected by later changes to the options object', async () => {
    const { fetch, calls } = stubFetch([
      json({ data: { id: 'c1' } }),
      json({ data: { id: 'c1' } }),
    ]);
    const options = {
      apiKey: 'original',
      baseUrl: 'https://api.example.test',
      fetch,
      retry: { maxRetries: 0 },
    };
    const sdk = new Kirora(options);
    options.apiKey = 'mutated';
    options.baseUrl = 'https://evil.example.test';
    options.retry.maxRetries = 5;

    await sdk.contacts.get('c1');
    await sdk.forWorkspace('tenant-42').contacts.get('c1');

    for (const call of calls) {
      expect(call.url).toBe('https://api.example.test/v1/contacts/c1');
      expect(header(call, 'authorization')).toBe('Bearer original');
    }
  });
});

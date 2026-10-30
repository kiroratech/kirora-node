import { describe, it, expect } from 'vitest';
import {
  KiroraConnectionError,
  KiroraError,
  KiroraTimeoutError,
} from '../errors/errors.js';
import { neverReached, operationFor, withEntryKeys } from './retry.js';
import { generated } from '../../test/helpers.js';

const segments = (path: string) => path.split('/');
const failed = (cause: unknown) => new KiroraConnectionError('POST /v1/x', cause);
const fetchFailed = (code: string) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });

describe('operationFor', () => {
  it('prefers a literal segment to a parameter', () => {
    expect(operationFor('GET', segments('/v1/templates/gallery'))).toBeDefined();
    expect(operationFor('POST', segments('/v1/contacts/batch'))).toEqual({
      id: 'identifyContactsBatch',
      retry: 'converges',
      acceptsKey: true,
    });
    expect(operationFor('POST', segments('/v1/contacts/c1/merge'))).toMatchObject({
      acceptsKey: true,
    });
  });

  it('finds nothing for an endpoint not in the spec', () => {
    expect(operationFor('POST', segments('/v1/notes'))).toBeUndefined();
    expect(operationFor('GET', segments('/v1/contacts/c1/extra/deep'))).toBeUndefined();
  });

  it('names the array of a batch whose entries take their own keys', () => {
    expect(operationFor('POST', segments('/v1/events/batch'))).toEqual({
      id: 'trackEventsBatch',
      retry: 'entries',
      acceptsKey: false,
      entries: 'events',
    });
  });
});

describe('withEntryKeys', () => {
  it('gives each entry without a key a new one, and keeps the rest', () => {
    const body = {
      events: [
        { name: 'a' },
        { name: 'b', idempotencyKey: null },
        { idempotencyKey: 'k' },
      ],
    };
    const keyed = withEntryKeys(body, 'events') as {
      events: { idempotencyKey: string }[];
    };

    expect(keyed.events.map((entry) => entry.idempotencyKey)).toEqual([
      generated,
      generated,
      'k',
    ]);
    expect(body.events[0]).toEqual({ name: 'a' });
  });

  it('leaves any other body as it is', () => {
    const body = { events: 'not a list' };
    expect(withEntryKeys(body, 'events')).toBe(body);
    expect(withEntryKeys(body, undefined)).toBe(body);
    expect(withEntryKeys([1], 'events')).toEqual([1]);
  });
});

describe('neverReached', () => {
  it('is true of a 429 and a connection that was never made', () => {
    expect(
      neverReached(new KiroraError({ code: 'RATE_LIMITED', message: '', status: 429 })),
    ).toBe(true);
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
      expect(neverReached(failed(fetchFailed(code)))).toBe(true);
    }
    const everyAddress = new AggregateError([
      Object.assign(new Error('a'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('b'), { code: 'ECONNREFUSED' }),
    ]);
    expect(
      neverReached(failed(new TypeError('fetch failed', { cause: everyAddress }))),
    ).toBe(true);
  });

  it('is false of a failure after the request may have been sent', () => {
    expect(neverReached(failed(fetchFailed('ECONNRESET')))).toBe(false);
    expect(neverReached(failed(new Error('socket closed')))).toBe(false);
    expect(
      neverReached(new KiroraTimeoutError('POST /v1/x', 10, fetchFailed('ECONNREFUSED'))),
    ).toBe(false);
    expect(
      neverReached(new KiroraError({ code: 'INTERNAL_ERROR', message: '', status: 500 })),
    ).toBe(false);
    const oneAddressReset = new AggregateError([
      Object.assign(new Error('a'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('b'), { code: 'ECONNRESET' }),
    ]);
    expect(neverReached(failed(oneAddressReset))).toBe(false);
  });
});

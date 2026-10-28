import { describe, it, expect } from 'vitest';
import { KiroraConnectionError, KiroraError } from '../src/index.js';

describe('KiroraError', () => {
  it('surfaces a code published after the SDK was built without throwing', () => {
    const error = new KiroraError({
      code: 'SOME_FUTURE_CODE',
      message: 'from a later release',
      status: 409,
    });
    expect(error.code).toBe('SOME_FUTURE_CODE');
    expect(error.isKnownCode()).toBe(false);
    expect(error.errors).toEqual([]);
  });

  it('is retryable for a 429 or a 5xx only', () => {
    const at = (status: number) =>
      new KiroraError({ code: 'X', message: 'm', status }).isRetryable;
    expect([at(400), at(409), at(429), at(500), at(503)]).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});

describe('KiroraConnectionError', () => {
  const message = (cause: unknown) =>
    new KiroraConnectionError('GET /v1/x', cause).message;

  it('uses the innermost message, through an empty AggregateError', () => {
    const refused = new Error('connect ECONNREFUSED');
    const fetchFailed = new TypeError('fetch failed', {
      cause: new AggregateError([refused], ''),
    });

    expect(message(fetchFailed)).toBe('GET /v1/x failed: connect ECONNREFUSED');
    expect(message('plain')).toBe('GET /v1/x failed: plain');
  });

  it('keeps the outer message when an AggregateError has nothing in it', () => {
    const fetchFailed = new TypeError('fetch failed', {
      cause: new AggregateError([], ''),
    });

    expect(message(fetchFailed)).toBe('GET /v1/x failed: fetch failed');
  });

  it('stops on a cyclic cause chain', () => {
    const self = new Error('self');
    self.cause = self;
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    const aggregate = new AggregateError([], '');
    aggregate.errors.push(aggregate);

    expect(message(self)).toBe('GET /v1/x failed: self');
    expect(message(a)).toBe('GET /v1/x failed: b');
    expect(message(aggregate)).toBe('GET /v1/x failed: AggregateError');
  });
});

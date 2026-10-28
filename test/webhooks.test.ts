import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  assertWebhookSignature,
  KiroraWebhookVerificationError,
  readWebhookHeaders,
  verifyWebhookSignature,
} from '../src/index.js';

const secret = 'whsec_reference';
const body = '{"eventId":"evt_1","type":"message.bounced"}';
const now = 1_790_000_000_000;
const timestamp = Math.floor(now / 1000);
/** The signature Kirora's server produces for this secret, timestamp and body. */
const signature =
  'sha256=786e82a809095e8f9308254ed5517ffda803370d60f531e5ac9aae4f9b95c841';

type Overrides = {
  secret?: string;
  body?: string | Buffer;
  signature?: string;
  timestamp?: string;
  now?: number;
  toleranceSeconds?: number;
};
const args = (overrides: Overrides) =>
  [
    overrides.secret ?? secret,
    overrides.body ?? body,
    overrides.signature ?? signature,
    overrides.timestamp ?? String(timestamp),
    { now: overrides.now ?? now, toleranceSeconds: overrides.toleranceSeconds },
  ] as const;
const verify = (overrides: Overrides) => verifyWebhookSignature(...args(overrides));
const failure = (overrides: Overrides) => {
  try {
    assertWebhookSignature(...args(overrides));
  } catch (error) {
    if (error instanceof KiroraWebhookVerificationError) return error.reason;
    throw error;
  }
  return undefined;
};

describe('verifyWebhookSignature', () => {
  it('accepts a signature the server produced', () => {
    expect(verify({})).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, and a malformed signature', () => {
    expect(verify({ body: `${body} ` })).toBe(false);
    expect(verify({ secret: 'whsec_other' })).toBe(false);
    // Must return false rather than throwing on a length mismatch.
    expect(verify({ signature: 'sha256=short' })).toBe(false);
  });

  it('refuses a replay: a stale request, or a fresh timestamp on an old signature', () => {
    expect(verify({ now: now + 301_000 })).toBe(false);
    expect(verify({ timestamp: String(timestamp + 60), now: now + 60_000 })).toBe(false);
  });

  it('accepts a Buffer body and any one of several signatures', () => {
    expect(
      verify({
        body: Buffer.from(body),
        signature: `sha256=${'0'.repeat(64)}, ${signature}`,
      }),
    ).toBe(true);
  });

  it('throws on invalid options rather than skipping the replay check', () => {
    expect(() => verify({ toleranceSeconds: Number.NaN })).toThrow(RangeError);
    expect(() => verify({ toleranceSeconds: -1 })).toThrow(RangeError);
    expect(() => verify({ now: Number.NaN })).toThrow(RangeError);
    expect(() => verify({ secret: '' })).toThrow('secret is required');
  });
});

describe('assertWebhookSignature', () => {
  it('returns for a valid webhook', () => {
    expect(failure({})).toBeUndefined();
  });

  it('says why a webhook failed', () => {
    expect(failure({ timestamp: '' })).toBe('invalid_timestamp');
    expect(failure({ timestamp: '12.5' })).toBe('invalid_timestamp');
    expect(failure({ body: `${body} ` })).toBe('signature_mismatch');
    expect(failure({ now: now + 301_000 })).toBe('timestamp_outside_tolerance');
    expect(failure({ now: now - 301_000 })).toBe('timestamp_outside_tolerance');
  });

  it('reports a bad signature before a stale timestamp', () => {
    const stale = String(timestamp - 3600);
    const signed = `sha256=${createHmac('sha256', secret).update(`${stale}.${body}`).digest('hex')}`;

    expect(failure({ timestamp: stale, signature: 'sha256=wrong' })).toBe(
      'signature_mismatch',
    );
    expect(failure({ timestamp: stale, signature: signed })).toBe(
      'timestamp_outside_tolerance',
    );
  });
});

describe('readWebhookHeaders', () => {
  it('reads the headers whatever their case, and requires the signature', () => {
    const headers = {
      'X-Webhook-Event': 'message.bounced',
      'x-webhook-event-id': 'evt_1',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': String(timestamp),
      'x-webhook-attempt': ['2'],
    };

    expect(readWebhookHeaders(headers)).toEqual({
      event: 'message.bounced',
      eventId: 'evt_1',
      attempt: 2,
      timestamp: String(timestamp),
      signature,
    });
    expect(
      readWebhookHeaders({ ...headers, 'x-webhook-signature': undefined }),
    ).toBeUndefined();
  });

  const headers = {
    'x-webhook-event': 'message.bounced',
    'x-webhook-event-id': 'evt_1',
    'x-webhook-signature': signature,
    'x-webhook-timestamp': String(timestamp),
  };

  it('requires every header but the attempt to be present and non-empty', () => {
    for (const name of Object.keys(headers)) {
      expect(readWebhookHeaders({ ...headers, [name]: undefined })).toBeUndefined();
      expect(readWebhookHeaders({ ...headers, [name]: '' })).toBeUndefined();
    }
    expect(readWebhookHeaders(headers)?.attempt).toBe(1);
  });

  it('requires the attempt to be a whole number from 1', () => {
    for (const attempt of ['oops', '0', '-1', '1.5', '', '1e3', '99999999999999999']) {
      expect(
        readWebhookHeaders({ ...headers, 'x-webhook-attempt': attempt }),
      ).toBeUndefined();
    }
  });

  it('reads a fetch Headers too', () => {
    expect(
      readWebhookHeaders(new Headers({ ...headers, 'x-webhook-attempt': '3' })),
    ).toEqual({
      event: 'message.bounced',
      eventId: 'evt_1',
      attempt: 3,
      timestamp: String(timestamp),
      signature,
    });
  });
});

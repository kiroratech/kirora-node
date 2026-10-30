import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  assertWebhook,
  assertWebhookHeaders,
  assertWebhookSignature,
  KiroraWebhookVerificationError,
  readWebhookHeaders,
  verifyWebhook,
  verifyWebhookSignature,
} from '../index.js';

const secret = 'whsec_reference';
const body = '{"eventId":"evt_1","type":"message.bounced"}';
const now = 1_790_000_000_000;
const timestamp = Math.floor(now / 1000);
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
/** Why `check` refused a webhook, or undefined if it didn't. */
const reasonOf = (check: () => unknown) => {
  try {
    check();
  } catch (error) {
    if (error instanceof KiroraWebhookVerificationError) return error.reason;
    throw error;
  }
  return undefined;
};
const failure = (overrides: Overrides) =>
  reasonOf(() => assertWebhookSignature(...args(overrides)));
const sign = (signedAt: string, raw: string) =>
  `sha256=${createHmac('sha256', secret).update(`${signedAt}.${raw}`).digest('hex')}`;

describe('verifyWebhookSignature', () => {
  it('accepts a signature the server produced', () => {
    expect(verify({})).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, and a malformed signature', () => {
    expect(verify({ body: `${body} ` })).toBe(false);
    expect(verify({ secret: 'whsec_other' })).toBe(false);
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
    const signed = sign(stale, body);

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

  it('says why the headers were refused, with assertWebhookHeaders', () => {
    const reason = (changes: Record<string, string | undefined>) =>
      reasonOf(() => assertWebhookHeaders({ ...headers, ...changes }));
    expect(reason({ 'x-webhook-timestamp': undefined })).toBe('invalid_timestamp');
    expect(reason({ 'x-webhook-signature': '' })).toBe('invalid_headers');
    expect(reason({ 'x-webhook-event': undefined })).toBe('invalid_headers');
    expect(reason({ 'x-webhook-event-id': '' })).toBe('invalid_headers');
    expect(reason({ 'x-webhook-attempt': '0' })).toBe('invalid_headers');
    expect(reason({})).toBeUndefined();
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

describe('assertWebhook', () => {
  const event = { eventId: 'evt_9', eventType: 'contact.created', data: { id: 'c1' } };
  const signed = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    const sig = sign(String(timestamp), raw);
    return {
      raw,
      headers: {
        'x-webhook-event': 'contact.created',
        'x-webhook-event-id': 'evt_9',
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-signature': sig,
      } as Record<string, string>,
    };
  };
  const reason = (raw: string, headers: Record<string, string>) =>
    reasonOf(() => assertWebhook(secret, raw, headers, { now }));

  it('returns the headers and the parsed body of a valid webhook', () => {
    const { raw, headers } = signed(event);
    expect(assertWebhook(secret, Buffer.from(raw), headers, { now })).toEqual({
      headers: expect.objectContaining({ event: 'contact.created', eventId: 'evt_9' }),
      payload: event,
    });
  });

  it('refuses event headers that don’t match the signed body', () => {
    const { raw, headers } = signed(event);
    expect(reason(raw, { ...headers, 'x-webhook-event': 'contact.deleted' })).toBe(
      'invalid_headers',
    );
    expect(reason(raw, { ...headers, 'x-webhook-event-id': 'evt_other' })).toBe(
      'invalid_headers',
    );
    const unlabelled = signed({ data: {} });
    expect(reason(unlabelled.raw, unlabelled.headers)).toBe('invalid_headers');
    expect(
      verifyWebhook(secret, raw, { ...headers, 'x-webhook-event-id': 'x' }, { now }),
    ).toBeUndefined();
  });

  it('still checks the signature and headers first', () => {
    const { raw, headers } = signed(event);
    expect(reason(`${raw} `, headers)).toBe('signature_mismatch');
    expect(reason(raw, { ...headers, 'x-webhook-timestamp': '' })).toBe(
      'invalid_timestamp',
    );
  });
});

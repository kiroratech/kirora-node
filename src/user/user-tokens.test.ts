import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { createUserToken } from '../index.js';

const secret = 'sdk_secret_reference';

function decode(token: string) {
  const [header, claims, signature] = token.split('.') as [string, string, string];
  const parse = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());
  return {
    header: parse(header),
    claims: parse(claims),
    signature,
    signed: `${header}.${claims}`,
  };
}

describe('createUserToken', () => {
  it('signs an HS256 token that lasts an hour by default', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = decode(createUserToken(secret, 'user-1'));

    expect(token.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(token.claims.sub).toBe('user-1');
    expect(token.claims.iat).toBeGreaterThanOrEqual(before);
    expect(token.claims.exp - token.claims.iat).toBe(3600);
    expect(token.signature).toBe(
      createHmac('sha256', secret).update(token.signed).digest('base64url'),
    );
  });

  it('accepts up to 24 hours', () => {
    const token = decode(createUserToken(secret, 'user-1', { expiresInSeconds: 86_400 }));
    expect(token.claims.exp - token.claims.iat).toBe(86_400);
  });

  it.each([86_401, 1.5, 0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects a lifetime of %s',
    (expiresInSeconds) => {
      expect(() => createUserToken(secret, 'user-1', { expiresInSeconds })).toThrow(
        RangeError,
      );
    },
  );

  it('rejects an empty secret or user id', () => {
    expect(() => createUserToken('', 'user-1')).toThrow('tokenSecret is required');
    expect(() => createUserToken(secret, '')).toThrow('userId is required');
  });
});

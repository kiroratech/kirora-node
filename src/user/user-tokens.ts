import { createHmac } from 'node:crypto';
import { checkNumber } from '../validation.js';

const DEFAULT_LIFETIME_SECONDS = 60 * 60;
const MAX_LIFETIME_SECONDS = 24 * 60 * 60;

/**
 * Creates a token that signs a user in to Kirora's web and mobile SDKs. Sign it on your
 * server with the SDK token secret from Developer → SDK in the dashboard, and keep the
 * secret there. `userId` is your own id for the signed-in user.
 *
 * Tokens last an hour unless `expiresInSeconds` says otherwise: a whole number from 1 to
 * 86,400 (24 hours). An empty secret or user id, or any other lifetime, throws.
 */
export function createUserToken(
  tokenSecret: string,
  userId: string,
  options: { expiresInSeconds?: number } = {},
): string {
  if (!tokenSecret) {
    throw new Error('tokenSecret is required');
  }
  if (!userId) {
    throw new Error('userId is required');
  }
  const lifetime = checkNumber(
    'expiresInSeconds',
    options.expiresInSeconds ?? DEFAULT_LIFETIME_SECONDS,
    (value) => Number.isInteger(value) && value >= 1 && value <= MAX_LIFETIME_SECONDS,
    `a whole number from 1 to ${MAX_LIFETIME_SECONDS}`,
  );
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (part: object) =>
    Buffer.from(JSON.stringify(part)).toString('base64url');
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: userId,
    iat: issuedAt,
    exp: issuedAt + lifetime,
  })}`;
  const signature = createHmac('sha256', tokenSecret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

import { createHmac } from 'node:crypto';
import { checkNumber } from './lib.js';

const DEFAULT_LIFETIME_SECONDS = 60 * 60;
const MAX_LIFETIME_SECONDS = 24 * 60 * 60;

/**
 * Creates a user token for Kirora's web and mobile SDKs. Serve it from a route on your
 * server so the SDK can sign the user in.
 *
 * `tokenSecret` is the SDK token secret from Developer → SDK; never expose it to the
 * browser. `userId` is your own id for the user (their contact's `externalId`). Tokens
 * last an hour by default and at most 24 hours. Throws if `tokenSecret` or `userId` is
 * empty, or `expiresInSeconds` isn't a whole number from 1 to 86,400.
 *
 * ```ts
 * app.get('/kirora-token', requireSignedIn, (request, response) => {
 *   response.send(createUserToken(process.env.KIRORA_SDK_TOKEN_SECRET!, request.user.id));
 * });
 * ```
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

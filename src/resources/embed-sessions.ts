import type { WithResponse } from '../core/client.js';
import { Resource, type IdempotentCallOptions, type Schemas } from './resource.js';

/** A token for Kirora's embedded builders, valid for 15 minutes. */
export type EmbedSession = Schemas['EmbedSession'];

export type CreateEmbedSessionParams = Schemas['CreateEmbedSessionInput'];

export class EmbedSessions extends Resource {
  /**
   * Creates a session for embedding Kirora's segment or email builder, for one tenant: call
   * it on your server through `kirora.forWorkspace()`, and give the token to the browser.
   * Partner keys with `allowedOrigins` only. Reusing an `idempotencyKey` within 24 hours
   * returns the first session again, whose token may have expired.
   */
  create(
    body: CreateEmbedSessionParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<EmbedSession>> {
    return this.unwrap('POST', '/v1/embed-sessions', options, { body });
  }
}

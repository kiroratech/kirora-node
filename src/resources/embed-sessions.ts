import type { WithResponse } from '../client.js';
import { Resource, type IdempotentCallOptions, type Schemas } from './resource.js';

export type EmbedSession = Schemas['EmbedSession'];

export type CreateEmbedSessionParams = Schemas['CreateEmbedSessionInput'];

/** Sessions for embedding Kirora's builders in your own app (partner keys only). */
export class EmbedSessions extends Resource {
  /**
   * `createEmbedSession`, for one tenant, so call it on `kirora.forWorkspace(externalId)`.
   * Its token lasts 15 minutes; give it to the embedded builders from your server. A key
   * you pass must be new per session, since reusing one returns the first session.
   */
  create(
    body: CreateEmbedSessionParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<EmbedSession>> {
    return this.unwrapIdempotent('POST', '/v1/embed-sessions', options, { body });
  }
}

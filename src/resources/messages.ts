import type { WithResponse } from '../core/client.js';
import type { PagePromise } from '../core/pagination.js';
import {
  Resource,
  path,
  type CallOptions,
  type PageOf,
  type QueryOf,
  type Schemas,
} from './resource.js';

/** A message from a campaign, journey or transactional send, whatever became of it. */
export type OutboundMessage = Schemas['OutboundMessage'];

export type MessagesListQuery = QueryOf<'listMessages'>;

export type MessagesPage = PageOf<'listMessages'>;

export class Messages extends Resource {
  /** Lists every message sent, queued, skipped or failed, newest first. */
  list(
    query: MessagesListQuery = {},
    options: CallOptions = {},
  ): PagePromise<MessagesPage> {
    return this.page('/v1/messages', query, options);
  }

  /** Returns one message, whatever its source and status. */
  get(
    messageId: string,
    options: CallOptions = {},
  ): Promise<WithResponse<OutboundMessage>> {
    return this.unwrap('GET', path`/v1/messages/${messageId}`, options);
  }
}

import type { WithResponse } from '../client.js';
import type { PagePromise } from '../pagination.js';
import {
  Resource,
  path,
  type CallOptions,
  type PageOf,
  type QueryOf,
  type Schemas,
} from './resource.js';

export type OutboundMessage = Schemas['OutboundMessage'];

export type MessagesListQuery = QueryOf<'listMessages'>;

export type MessagesPage = PageOf<'listMessages'>;

export class Messages extends Resource {
  /**
   * `listMessages`: every message sent, by any campaign, journey or transactional send,
   * newest first. Filter by `status`, `recipient`, `correlationId` and more.
   */
  list(
    query: MessagesListQuery = {},
    options: CallOptions = {},
  ): PagePromise<MessagesPage> {
    return this.page('/v1/messages', query, options);
  }

  /** `getMessage`: one message from the log, whatever sent it. */
  get(
    messageId: string,
    options: CallOptions = {},
  ): Promise<WithResponse<OutboundMessage>> {
    return this.unwrap('GET', path`/v1/messages/${messageId}`, options);
  }
}

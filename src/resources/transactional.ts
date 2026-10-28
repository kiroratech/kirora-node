import type { WithResponse } from '../client.js';
import type { OutboundMessage } from './messages.js';
import {
  Resource,
  path,
  withIdempotencyKeys,
  type CallOptions,
  type IdempotentCallOptions,
  type Schemas,
} from './resource.js';

export type TransactionalMessage = Schemas['TransactionalMessage'];
export type TransactionalSendResult = Schemas['TransactionalSendResult'];
export type SendTransactionalMessagesBatchResult =
  Schemas['SendTransactionalMessagesBatchResult'];

export type SendTransactionalParams = Schemas['SendTransactionalInput'];
export type SendTransactionalBatchParams = Schemas['SendTransactionalMessagesBatchInput'];

export class Transactional extends Resource {
  /** `sendTransactionalMessage`. Retries reuse one idempotency key, so they never send twice. */
  send(
    body: SendTransactionalParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<TransactionalSendResult>> {
    return this.unwrapIdempotent('POST', '/v1/transactional/messages', options, { body });
  }

  /**
   * `sendTransactionalMessagesBatch`. Up to 100 messages, each with its own
   * `idempotencyKey`. Each result is either the sent messages or an error.
   */
  sendBatch(
    body: SendTransactionalBatchParams,
    options: CallOptions = {},
  ): Promise<WithResponse<SendTransactionalMessagesBatchResult>> {
    return this.unwrap('POST', '/v1/transactional/messages/batch', options, {
      body: { ...body, messages: withIdempotencyKeys(body.messages) },
      repeatable: true,
    });
  }

  /**
   * `cancelScheduledTransactionalMessage`, before its `sendAt`. A key is made for this
   * call, so a retry replays the result rather than failing once it's cancelled.
   */
  cancel(
    messageId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<OutboundMessage>> {
    return this.unwrapIdempotent(
      'POST',
      path`/v1/transactional/messages/${messageId}/cancel`,
      options,
    );
  }
}

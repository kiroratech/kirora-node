import type { WithResponse } from '../core/client.js';
import type { OutboundMessage } from './messages.js';
import {
  Resource,
  path,
  type CallOptions,
  type IdempotentCallOptions,
  type Schemas,
} from './resource.js';

/** A message a transactional send created, one for each channel it sends on. */
export type TransactionalMessage = Schemas['TransactionalMessage'];
export type TransactionalSendResult = Schemas['TransactionalSendResult'];
export type SendTransactionalMessagesBatchResult =
  Schemas['SendTransactionalMessagesBatchResult'];

export type SendTransactionalParams = Schemas['SendTransactionalInput'];
export type SendTransactionalBatchParams = Schemas['SendTransactionalMessagesBatchInput'];

export class Transactional extends Resource {
  /**
   * Sends a one-off message to one recipient, such as a receipt or a password reset. It
   * ignores marketing preferences, but not suppressions.
   */
  send(
    body: SendTransactionalParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<TransactionalSendResult>> {
    return this.unwrap('POST', '/v1/transactional/messages', options, { body });
  }

  /**
   * Sends up to 100 messages, each as `send()` would. One refused doesn't stop the rest:
   * each entry of `results`, in the order sent, has its messages or an `error`. Give each
   * entry an `idempotencyKey` so your own retries replay it rather than send it twice.
   */
  sendBatch(
    body: SendTransactionalBatchParams,
    options: CallOptions = {},
  ): Promise<WithResponse<SendTransactionalMessagesBatchResult>> {
    return this.unwrap('POST', '/v1/transactional/messages/batch', options, {
      body,
    });
  }

  /**
   * Cancels a message scheduled with `sendAt` before it goes. Cancelling it again resolves
   * with it as it is. Once it has started sending, it throws a `KiroraError` with code
   * `CONFLICT`.
   */
  cancel(
    messageId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<OutboundMessage>> {
    return this.unwrap(
      'POST',
      path`/v1/transactional/messages/${messageId}/cancel`,
      options,
    );
  }
}

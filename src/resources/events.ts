import type { WithResponse } from '../client.js';
import {
  Resource,
  withIdempotencyKeys,
  type CallOptions,
  type IdempotentCallOptions,
  type Schemas,
} from './resource.js';

export type TrackedEvent = Schemas['TrackedEvent'];
export type TrackEventsBatchResult = Schemas['TrackEventsBatchResult'];

export type TrackEventParams = Schemas['TrackEventInput'];
export type TrackEventsBatchParams = Schemas['TrackEventsBatchInput'];

export class Events extends Resource {
  /** `trackEvent`. Retries reuse one idempotency key, so they never record it twice. */
  track(
    body: TrackEventParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<TrackedEvent>> {
    return this.unwrapIdempotent('POST', '/v1/events/track', options, { body });
  }

  /**
   * `trackEventsBatch`. Up to 100 events, each with its own `idempotencyKey`. Each
   * result is either the event or an error.
   */
  trackBatch(
    body: TrackEventsBatchParams,
    options: CallOptions = {},
  ): Promise<WithResponse<TrackEventsBatchResult>> {
    return this.unwrap('POST', '/v1/events/batch', options, {
      body: { ...body, events: withIdempotencyKeys(body.events) },
      repeatable: true,
    });
  }
}

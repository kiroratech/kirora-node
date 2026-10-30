import type { WithResponse } from '../core/client.js';
import {
  Resource,
  type CallOptions,
  type IdempotentCallOptions,
  type Schemas,
} from './resource.js';

export type TrackedEvent = Schemas['TrackedEvent'];
export type TrackEventsBatchResult = Schemas['TrackEventsBatchResult'];

export type TrackEventParams = Schemas['TrackEventInput'];
export type TrackEventsBatchParams = Schemas['TrackEventsBatchInput'];

export class Events extends Resource {
  /**
   * Records an event against a contact, which must already exist. Pass an
   * `idempotencyKey` derived from your own event id, or a retry of yours can record it
   * twice. A workspace tracks at most 1,000 distinct names, so keep ids in `properties`.
   */
  track(
    body: TrackEventParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<TrackedEvent>> {
    return this.unwrap('POST', '/v1/events/track', options, { body });
  }

  /**
   * Tracks up to 100 events, each as `track()` would. One refused doesn't stop the rest:
   * each entry of `results`, in the order sent, has the event or an `error`. Give each
   * entry an `idempotencyKey` so your own retries replay it rather than record it twice.
   */
  trackBatch(
    body: TrackEventsBatchParams,
    options: CallOptions = {},
  ): Promise<WithResponse<TrackEventsBatchResult>> {
    return this.unwrap('POST', '/v1/events/batch', options, {
      body,
    });
  }
}

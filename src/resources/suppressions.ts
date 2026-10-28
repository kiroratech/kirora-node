import type { WithResponse } from '../client.js';
import type { PagePromise } from '../pagination.js';
import {
  Resource,
  type CallOptions,
  type IdempotentCallOptions,
  type PageOf,
  type QueryOf,
  type Schemas,
} from './resource.js';

export type Suppression = Schemas['Suppression'];
export type AddedSuppressions = Schemas['AddedSuppressions'];
export type DeletedSuppressions = Schemas['DeletedSuppressions'];

export type AddSuppressionsParams = Schemas['AddSuppressionsInput'];
export type DeleteSuppressionsParams = Schemas['DeleteSuppressionsInput'];

export type SuppressionsListQuery = QueryOf<'listSuppressions'>;

export type SuppressionsPage = PageOf<'listSuppressions'>;

/** Email addresses Kirora never sends to, such as after a bounce or complaint. */
export class Suppressions extends Resource {
  /** `listSuppressions` */
  list(
    query: SuppressionsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<SuppressionsPage> {
    return this.page('/v1/suppressions', query, options);
  }

  /** `addSuppressions`. Addresses already suppressed are skipped, so it's safe to retry. */
  add(
    body: AddSuppressionsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<AddedSuppressions>> {
    return this.unwrapRepeatable('POST', '/v1/suppressions', options, { body });
  }

  /**
   * `deleteSuppressions`, so the addresses can be sent to again. Addresses not
   * suppressed are skipped, so it's safe to retry.
   */
  delete(
    body: DeleteSuppressionsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<DeletedSuppressions>> {
    return this.unwrapRepeatable('POST', '/v1/suppressions/delete', options, { body });
  }
}

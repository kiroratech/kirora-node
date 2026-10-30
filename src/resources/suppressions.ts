import type { WithResponse } from '../core/client.js';
import type { PagePromise } from '../core/pagination.js';
import {
  Resource,
  type CallOptions,
  type IdempotentCallOptions,
  type PageOf,
  type QueryOf,
  type Schemas,
} from './resource.js';

/** An email address the workspace won't send to, and why. */
export type Suppression = Schemas['Suppression'];
export type AddedSuppressions = Schemas['AddedSuppressions'];
export type DeletedSuppressions = Schemas['DeletedSuppressions'];

export type AddSuppressionsParams = Schemas['AddSuppressionsInput'];
export type DeleteSuppressionsParams = Schemas['DeleteSuppressionsInput'];

export type SuppressionsListQuery = QueryOf<'listSuppressions'>;

export type SuppressionsPage = PageOf<'listSuppressions'>;

export class Suppressions extends Resource {
  /** Lists the blocked email addresses, newest first. Filter by `email` to check one. */
  list(
    query: SuppressionsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<SuppressionsPage> {
    return this.page('/v1/suppressions', query, options);
  }

  /**
   * Blocks up to 10,000 email addresses, with reason `imported`. One already blocked keeps
   * its reason, and entries that aren't addresses come back in `invalid`.
   */
  add(
    body: AddSuppressionsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<AddedSuppressions>> {
    return this.unwrap('POST', '/v1/suppressions', options, { body });
  }

  /**
   * Unblocks up to 100 email addresses. Only `manual` and `imported` blocks can be removed:
   * bounces, complaints and unsubscribes come back in `notRemovable`.
   */
  delete(
    body: DeleteSuppressionsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<DeletedSuppressions>> {
    return this.unwrap('POST', '/v1/suppressions/delete', options, { body });
  }
}
